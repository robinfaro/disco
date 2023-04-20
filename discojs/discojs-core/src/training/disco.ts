import {
  client as clients,
  data,
  Logger,
  Task,
  TrainingInformant, informant as informants,
  TrainingSchemes,
  Memory, EmptyMemory,
  ConsoleLogger,
  TrainingFunction
} from '..'
import { Trainer } from './trainer/trainer'
import { TrainerBuilder } from './trainer/trainer_builder'
import { TrainerLog } from '../logging/trainer_logger'
import { Aggregator } from '../aggregator'
import { MeanAggregator } from '../aggregator/mean'

interface DiscoOptions {
  client?: clients.Client
  aggregator?: Aggregator
  url?: string | URL
  scheme?: TrainingSchemes
  informant?: TrainingInformant
  logger?: Logger
  memory?: Memory
  customTrainingFunction?: TrainingFunction
}

// Handles the training loop, server communication & provides the user with feedback.
export class Disco {
  public readonly task: Task
  public readonly logger: Logger
  public readonly memory: Memory
  private readonly client: clients.Client
  private readonly aggregator: Aggregator
  private readonly trainer: Promise<Trainer>

  // client need to be connected
  constructor (
    task: Task,
    options: DiscoOptions
  ) {
    if (options.scheme === undefined) {
      options.scheme = TrainingSchemes[task.trainingInformation.scheme as keyof typeof TrainingSchemes]
    }
    if (options.aggregator === undefined) {
      options.aggregator = new MeanAggregator(task)
    }
    if (options.client === undefined) {
      if (options.url === undefined) {
        throw new Error('could not determine client from given parameters')
      }

      if (typeof options.url === 'string') {
        options.url = new URL(options.url)
      }
      switch (options.scheme) {
        case TrainingSchemes.FEDERATED:
          options.client = new clients.federated.FederatedClient(options.url, task, options.aggregator)
          break
        case TrainingSchemes.DECENTRALIZED:
          options.client = new clients.decentralized.DecentralizedClient(options.url, task, options.aggregator)
          break
        default:
          options.client = new clients.Local(options.url, task, options.aggregator)
          break
      }
    }
    if (options.informant === undefined) {
      switch (options.scheme) {
        case TrainingSchemes.FEDERATED:
          options.informant = new informants.FederatedInformant(task)
          break
        case TrainingSchemes.DECENTRALIZED:
          options.informant = new informants.DecentralizedInformant(task)
          break
        default:
          options.informant = new informants.LocalInformant(task)
          break
      }
    }
    if (options.logger === undefined) {
      options.logger = new ConsoleLogger()
    }
    if (options.memory === undefined) {
      options.memory = new EmptyMemory()
    }
    if (options.client.task !== task) {
      throw new Error('client not setup for given task')
    }
    if (options.informant.task.taskID !== task.taskID) {
      throw new Error('informant not setup for given task')
    }

    this.task = task
    this.client = options.client
    this.aggregator = options.aggregator
    this.memory = options.memory
    this.logger = options.logger

    const trainerBuilder = new TrainerBuilder(this.memory, this.task, options.informant, options.customTrainingFunction)
    this.trainer = trainerBuilder.build(this.aggregator, this.client, options.scheme !== TrainingSchemes.LOCAL)
  }

  async fit (dataTuple: data.DataSplit): Promise<void> {
    this.logger.success(
      'Thank you for your contribution. Data preprocessing has started')

    const trainData = dataTuple.train.preprocess().batch()
    const validationData = dataTuple.validation?.preprocess().batch() ?? trainData

    await this.client.connect()
    const trainer = await this.trainer
    await trainer.fitModel(trainData.dataset, validationData.dataset)
  }

  // Stops the training function. Does not disconnect the client.
  async pause (): Promise<void> {
    await (await this.trainer).stopTraining()

    this.logger.success('Training was successfully interrupted.')
  }

  async close (): Promise<void> {
    await this.pause()
    await this.client.disconnect()
  }

  async logs (): Promise<TrainerLog> {
    const trainer = await this.trainer
    return trainer.getTrainerLog()
  }
}
