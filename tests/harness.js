let currentSuite = '';
let passCount = 0;
let failCount = 0;
const failures = [];
const queue = [];

// describe/test only REGISTER work; run() executes it sequentially and
// awaits each test before starting the next. Without this, async test
// bodies interleave and later tests see partially-set-up state from
// tests that haven't finished yet.
export function describe(name, fn) {
  currentSuite = name;
  fn();
}

export function test(name, fn) {
  queue.push({ suite: currentSuite, name, fn });
}

export async function run() {
  for (const { suite, name, fn } of queue) {
    const label = `${suite} > ${name}`;
    try {
      await fn();
      passCount += 1;
      console.log(`  \x1b[32m\u2713\x1b[0m ${label}`);
    } catch (error) {
      failCount += 1;
      failures.push({ label, error });
      console.log(`  \x1b[31m\u2717\x1b[0m ${label}`);
      console.log(`      ${error.message}`);
    }
  }
}

export function assert(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    );
  }
}

export function assertThrows(fn, message = 'Expected function to throw') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

export function summary() {
  console.log('\n' + '\u2500'.repeat(40));
  console.log(`  ${passCount} passed, ${failCount} failed`);
  console.log('\u2500'.repeat(40));
  if (failCount > 0) {
    process.exitCode = 1;
  }
}
