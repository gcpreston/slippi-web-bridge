/**
 * Returns either the promise resolved or a rejection after a specified timeout.
 */
export const promiseTimeout = <T>(ms: number, promise: Promise<T>): Promise<T> => {
  // Create a promise that rejects in <ms> milliseconds
  const timeout = new Promise((_resolve, reject): void => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Timed out after ${ms}ms.`));
    }, ms);
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([promise, timeout]) as Promise<T>;
};
