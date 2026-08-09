# Changelog

## [1.7.1](https://github.com/workscribe/cli/compare/v1.8.0...v1.7.1) (2026-08-09)

## [1.7.0](https://github.com/workscribe/cli/compare/v1.6.2...v1.7.0) (2026-06-09)

## [1.6.2](https://github.com/workscribe/cli/compare/v1.6.1...v1.6.2) (2026-05-31)

## [1.6.1](https://github.com/workscribe/cli/compare/v1.6.0...v1.6.1) (2026-05-28)

### Features

* include OS username in Slack webhook sender name ([2605978](https://github.com/workscribe/cli/commit/2605978a36e6728a68e19caccbfefaa4a0bd5c7a))

### Bug Fixes

* embed OS username in Slack message body ([8184c3a](https://github.com/workscribe/cli/commit/8184c3aa493f58ef76e6e1406cb115605c0ac23f))

## [1.6.0](https://github.com/workscribe/cli/compare/v1.5.0...v1.6.0) (2026-05-28)

### Features

* classify npx commands and add lint_run category ([3e28886](https://github.com/workscribe/cli/commit/3e2888602fc0f245ff215bdb0457cf50adc1c102))
* complete Slack integration ([9933f52](https://github.com/workscribe/cli/commit/9933f52360a1a145348636a14715d729f8891699))
* dependency inference, JSON summary output, and new event categories ([025dc48](https://github.com/workscribe/cli/commit/025dc4866c1c9d48efdc372a9af71d128a8f6ef8))

## [1.5.0](https://github.com/workscribe/cli/compare/v1.4.0...v1.5.0) (2026-05-28)

### Features

* add bun support and fix yarn/pnpm test_run metadata ([2cd7689](https://github.com/workscribe/cli/commit/2cd76896bd776b900d874cf84a0d6bbad9c8514b))
* add code_search, code_read, file_ops categories ([582be71](https://github.com/workscribe/cli/commit/582be71c7c40642c7c935682bc5ed9b562066e09))
* add workscribe clear command to delete events for a date ([ff16c2c](https://github.com/workscribe/cli/commit/ff16c2c4b7baea4a1d489ec40d92bafc889ad1b7))
* refine AI summary payload and system prompt ([42ea030](https://github.com/workscribe/cli/commit/42ea030b22ee4ad045f037a143b86a4b5fe88fa4))

## [1.4.0](https://github.com/workscribe/cli/compare/v1.3.0...v1.4.0) (2026-05-28)

### Features

* AI session capture phase 2+3 — hook integration and git snapshot ([c0dbfad](https://github.com/workscribe/cli/commit/c0dbfad59cdb746fe5ac57554eb35ad1cb4fb053))
* ai_session display badge in events log ([f08f8b7](https://github.com/workscribe/cli/commit/f08f8b70e29e40d1df2d958ecceae44d24bbad7c))

### Bug Fixes

* built-in workscribe filter, git -C support, environment event exclusion ([e48b914](https://github.com/workscribe/cli/commit/e48b914c8f26ade30b0b41e9b0c8450bb29d9367))

## [1.3.0](https://github.com/workscribe/cli/compare/v1.2.2...v1.3.0) (2026-05-28)

### Features

* AI session capture phase 1 — registry-driven normalize rules ([dfbf0a1](https://github.com/workscribe/cli/commit/dfbf0a1e241893cd917167daec0b461b6f0baf51))

## [1.2.2](https://github.com/workscribe/cli/compare/v1.2.1...v1.2.2) (2026-05-27)

## [1.2.1](https://github.com/workscribe/cli/compare/v1.2.0...v1.2.1) (2026-05-27)

### Bug Fixes

* always render session heading from data, not from AI output ([a5d6321](https://github.com/workscribe/cli/commit/a5d6321baed3ba3a6902f6f848bf09a20627f425))

## [1.2.0](https://github.com/workscribe/cli/compare/v1.1.3...v1.2.0) (2026-05-27)

### Features

* pre-IDE integration work items ([7542d0f](https://github.com/workscribe/cli/commit/7542d0f9f075f0ba462e065e9f3b5a90cf4e8684))

## [1.1.3](https://github.com/workscribe/cli/compare/v1.1.2...v1.1.3) (2026-05-27)

### Bug Fixes

* improve summary quality for local models ([1c1d477](https://github.com/workscribe/cli/commit/1c1d477c260f03745930446586c4fdd9ed30a095))

## [1.1.2](https://github.com/workscribe/cli/compare/v1.1.1...v1.1.2) (2026-05-27)

### Bug Fixes

* ensure version is always fresh at build time ([4b8dc63](https://github.com/workscribe/cli/commit/4b8dc63b977353895be370c9ecb44e349b11a256))

## [1.1.1](https://github.com/workscribe/cli/compare/v1.1.0...v1.1.1) (2026-05-27)

### Bug Fixes

* read version from package.json at build time via tsup define ([7e0e130](https://github.com/workscribe/cli/commit/7e0e130c21a7e0912e2c9c85f46eee4ea245ad65))

## [1.1.0](https://github.com/workscribe/cli/compare/v1.0.2...v1.1.0) (2026-05-27)

### Features

* add workscribe pause and resume commands ([9e7a9aa](https://github.com/workscribe/cli/commit/9e7a9aa1f3abc71ad618e6475329cea2d880167b))

## [1.0.2](https://github.com/workscribe/cli/compare/v1.0.1...v1.0.2) (2026-05-27)

## [1.0.1](https://github.com/eldrego/workscribe/compare/v1.0.0...v1.0.1) (2026-05-27)

### Bug Fixes

* security hardening across capture, storage, and AI providers ([4a5b55e](https://github.com/eldrego/workscribe/commit/4a5b55e64e302102e364556b64d93cbd5afd12a9))

## [1.0.0](https://github.com/eldrego/chronicle/compare/v0.2.1...v1.0.0) (2026-05-24)

### ⚠ BREAKING CHANGES

* rename application from Chronicle to Workscribe

### Features

* rename application from Chronicle to Workscribe ([71646db](https://github.com/eldrego/chronicle/commit/71646db95553467ff9b3c79e870f012abf582dd5))

## [0.2.1](https://github.com/eldrego/workscribe/compare/v0.2.0...v0.2.1) (2026-05-24)

## 0.2.0 (2026-05-24)

### Features

* initial Workscribe MVP ([4dd2d4c](https://github.com/eldrego/workscribe/commit/4dd2d4cd719ea19180836f79c62c9818f71bcd9a))

### Bug Fixes

* correct shell hook path for global npm install ([855133d](https://github.com/eldrego/workscribe/commit/855133de27492f1feba142b9d063069b4b516423))
* set publishConfig access to public for scoped package ([c5c725e](https://github.com/eldrego/workscribe/commit/c5c725edc47d88949fdd1d61a4f27216d2ba5883))

All notable changes to this project will be documented in this file.
