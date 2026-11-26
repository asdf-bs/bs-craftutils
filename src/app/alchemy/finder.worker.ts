/// <reference lib="webworker" />

import { createPotionFinderSearch, PotionFinderWorkerRequest, PotionFinderWorkerResponse } from './finder';

const workerScope = self as DedicatedWorkerGlobalScope;
let activeSearchId = -1;

workerScope.addEventListener('message', (event: MessageEvent<PotionFinderWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (request.id === activeSearchId) activeSearchId = -1;
    return;
  }

  activeSearchId = request.id;
  try {
    const task = createPotionFinderSearch(request.input);
    const processChunk = () => {
      if (request.id !== activeSearchId) return;
      if (task.processNext(32)) {
        const response: PotionFinderWorkerResponse = { type: 'result', id: request.id, result: task.result };
        workerScope.postMessage(response);
        activeSearchId = -1;
      } else {
        setTimeout(processChunk, 0);
      }
    };
    processChunk();
  } catch (error) {
    const response: PotionFinderWorkerResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Potion search failed.'
    };
    workerScope.postMessage(response);
    activeSearchId = -1;
  }
});