import type tf from '@tensorflow/tfjs'

import type { Model, Memory, Task, TrainingInformant, client as clients } from '../..'
import type { Aggregator } from '../../aggregator'

import { Trainer } from './trainer'

/**
 * Class whose role is to train a model in a distributed way with a given dataset.
 */
export class DistributedTrainer extends Trainer {
  private readonly aggregator: Aggregator

  /**
   * DistributedTrainer constructor, accepts same arguments as Trainer and in additional also a client who takes care of communicating weights.
   */
  constructor (
    task: Task,
    trainingInformant: TrainingInformant,
    memory: Memory,
    model: Model,
    private readonly client: clients.Client
  ) {
    super(task, trainingInformant, memory, model)
    this.aggregator = this.client.aggregator
    this.aggregator.setModel(model)
  }

  async onTrainBegin (logs?: tf.Logs): Promise<void> {
    await super.onTrainBegin(logs)
    await this.client.onTrainBeginCommunication(this.model.weights, this.trainingInformant)
  }

  async onRoundBegin (accuracy: number): Promise<void> {
    await this.client.onRoundBeginCommunication(this.model.weights, this.roundTracker.round, this.trainingInformant)
  }

  /**
   * Callback called every time a round is over
   */
  async onRoundEnd (accuracy: number): Promise<void> {
    await this.client.onRoundEndCommunication(this.model.weights, this.roundTracker.round, this.trainingInformant)
    if (this.aggregator.model !== undefined) {
      // The aggregator's own aggregation is async. The trainer updates its model to match the aggregator's
      // after it has completed a round of training.
      this.model.weights = this.aggregator.model.weights
    }

    await this.memory.updateWorkingModel(
      { taskID: this.task.id, name: this.task.trainingInformation.modelID },
      this.model
    )
  }
}
