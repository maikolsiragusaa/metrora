import type { SwarmEventV1, SwarmWorkerRequestV1, SwarmWorkerResultV1 } from './contract-v1'

export type WorkerAdapterObserveV1 = (event: SwarmEventV1) => void

export type WorkerAdapterStartOptionsV1 = {
  signal?: AbortSignal
}

export type WorkerExecutionV1 = {
  workerId: string
  result: Promise<SwarmWorkerResultV1>
  cancel: () => void
}

/**
 * A bounded worker lifecycle. A runtime adapter can be replaced without
 * changing Swarm contracts or coordinator mechanics.
 */
export interface WorkerAdapterV1 {
  readonly adapterId: string
  start(
    request: SwarmWorkerRequestV1,
    observe: WorkerAdapterObserveV1,
    options?: WorkerAdapterStartOptionsV1,
  ): WorkerExecutionV1
  run(
    request: SwarmWorkerRequestV1,
    observe?: WorkerAdapterObserveV1,
    options?: WorkerAdapterStartOptionsV1,
  ): Promise<SwarmWorkerResultV1>
  cancel(workerId: string): Promise<void>
}
