import tf from '@tensorflow/tfjs'

import { Sink } from '../utils/event_emitter'
import { WeightsContainer } from '..'

import { Model } from '.'
import type { EpochLogs, Prediction, Sample } from './model'
import type { Dataset } from '../dataset'

/** TensorFlow JavaScript model with standard training */
export class TFJS extends Model {
  /** Wrap the given trainable model */
  constructor (
    private readonly model: tf.LayersModel
  ) {
    super()

    if (model.loss === undefined) {
      throw new Error('TFJS models need to be compiled to be used')
    }
  }

  override get weights (): WeightsContainer {
    return new WeightsContainer(this.model.weights.map((w) => w.read()))
  }

  override set weights (ws: WeightsContainer) {
    this.model.setWeights(ws.weights)
  }

  override async * train (
    trainingData: Dataset,
    validationData?: Dataset,
    epochs = 1,
    tracker = new Sink()
  ): AsyncGenerator<EpochLogs> {
    for (let i = 0; i < epochs; i++) {
      let logs: tf.Logs | undefined

      await this.model.fitDataset(trainingData, {
        epochs: 1,
        validationData,
        callbacks: {
          onEpochEnd: (_, cur) => { logs = cur },
          onBatchBegin: () => { tracker.emit('batchBegin', undefined) },
          onBatchEnd: () => { tracker.emit('batchEnd', undefined) }
        }
      })

      yield logs
    }
  }

  override async predict (input: Sample): Promise<Prediction> {
    const ret = this.model.predict(input)
    if (Array.isArray(ret)) {
      throw new Error('prediction yield many Tensors but should have only returned one')
    }

    return ret
  }

  static async deserialize (raw: tf.io.ModelArtifacts): Promise<Model> {
    return new this(await tf.loadLayersModel({
      load: async () => raw
    }))
  }

  async serialize (): Promise<tf.io.ModelArtifacts> {
    let resolveArtifacts: (_: tf.io.ModelArtifacts) => void
    const ret = new Promise<tf.io.ModelArtifacts>((resolve) => { resolveArtifacts = resolve })

    await this.model.save({
      save: async (artifacts) => {
        resolveArtifacts(artifacts)
        return {
          modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: 'JSON'
          }
        }
      }
    }, {
      includeOptimizer: true // keep model compiled
    })

    return await ret
  }

  /**
   * extract wrapped model
   *
   * @deprecated use `Model` instead of relying on tf specifics
   */
  extract (): tf.LayersModel {
    return this.model
  }
}
