// Vitest global setup — runs before each test file.
//
// Workstream B/E (amendment 3): createOcrEngineFromEnv fails-closed when
// SCREENSHOT_OCR_ENGINE is missing/invalid. Several integration tests call
// buildApp() WITHOUT injecting screenshotServiceOptions.ocrEngine, which
// exercises the production auto-wiring path that calls
// createOcrEngineFromEnv(process.env). To preserve the historical mock-OCR
// default for those tests (without weakening the production fail-closed
// contract), we set SCREENSHOT_OCR_ENGINE=mock here unless a test has
// already set it explicitly.
//
// Tests that want to assert the fail-closed behaviour pass an explicit env
// object to createOcrEngineFromEnv({...}) (not process.env), so they are
// unaffected by this default.
//
// `??=` keeps any value a test sets before this runs, and allows a test to
// delete the var in a beforeEach if it needs the unset path via process.env.
process.env.SCREENSHOT_OCR_ENGINE ??= 'mock';
