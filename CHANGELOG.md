# Changelog

## [1.15.1](https://github.com/workscribe/cli/compare/v1.15.0...v1.15.1) (2026-10-06)

### Bug Fixes

* stop alert check from firing during shell init ([74166be](https://github.com/workscribe/cli/commit/74166be45b4808682847d767672b7140e9cd3bc6))

## [1.14.2](https://github.com/workscribe/cli/compare/v1.14.1...v1.14.2) (2026-10-03)

### Bug Fixes

* register zsh completion via compdef and stop duplicate rc-file inserts ([0df8645](https://github.com/workscribe/cli/commit/0df86456fe0c9a8da980f2d285b89917c6c71b51)), closes [#compdef](https://github.com/workscribe/cli/issues/compdef)

## [1.14.1](https://github.com/workscribe/cli/compare/v1.14.0...v1.14.1) (2026-10-02)

### Bug Fixes

* pin node interpreter alongside binary path in both hook mechanisms ([139561b](https://github.com/workscribe/cli/commit/139561bdac317fd5c91e3b4d6bfe4433f0ad67ab))
* run the Node version guard before anything can load node:sqlite ([4b52657](https://github.com/workscribe/cli/commit/4b526578e699097ea41eccdd0e90276963646633))

## [1.14.0](https://github.com/workscribe/cli/compare/v1.13.0...v1.14.0) (2026-08-29)

### Features

* add `--json` output to `workscribe context` ([8212c72](https://github.com/workscribe/cli/commit/8212c7202cb0f6645dfe0dbfbba4678dd41a1bcb))
* add `git.qualifyRepoName` to disambiguate repos with colliding names ([68f4601](https://github.com/workscribe/cli/commit/68f4601fc7d572c582df7eba85ca21f46a22448f))

## [1.13.0](https://github.com/workscribe/cli/compare/v1.12.0...v1.13.0) (2026-08-27)

### Features

* add Gemini and Groq AI providers (WOR-12) ([2145968](https://github.com/workscribe/cli/commit/21459684dd1b38a7a38426bd0e51180ed6cf113d))
* core CLI changes for IDE integration (WOR-11) ([ecd73da](https://github.com/workscribe/cli/commit/ecd73da837b4d92654aa5a53a30a0fa39b13f777))
* **WOR-75:** resolve workscribe binary path at init time ([2b22c21](https://github.com/workscribe/cli/commit/2b22c2105499c91f75ac98ee2cfba471fa8effe0))
* **WOR-76:** AI session secret detection with shell hook alerts ([e5fb735](https://github.com/workscribe/cli/commit/e5fb735b3ba5e897ca9a85ecac0be52d73ded278))
* **WOR-77:** AI tool registry expansion and resolver layer ([eda9054](https://github.com/workscribe/cli/commit/eda905434bb476e9bf11be99162e87e6294c61f6))
* workscribe context command (WOR-82) ([ced357c](https://github.com/workscribe/cli/commit/ced357cfac02baf9f3ecc45695a4f825552155f5))

### Bug Fixes

* session grouping v2 — multi-repo gap threshold and IDE idle reset (WOR-72) ([171b896](https://github.com/workscribe/cli/commit/171b8969b89b5bbf28aebbb3a721fffd81eb35a0))
* **WOR-35:** correct Aider history regex to match actual #### format ([59dcd1b](https://github.com/workscribe/cli/commit/59dcd1b0a7b03587081bb8412f7afac7b046644c)), closes [#916](https://github.com/workscribe/cli/issues/916)
* **WOR-74:** redact credentials embedded in connection string URLs ([f533a5e](https://github.com/workscribe/cli/commit/f533a5eaab879a20f2cd14c51e15f01460a18c3b))
* **WOR-80:** version-manager-aware Node 22 upgrade message ([84f050e](https://github.com/workscribe/cli/commit/84f050ec6fd8203ffe413981d3252dc9d4a63238))
* **WOR-81:** exclude long-running commands from idle gap calculation ([1a13029](https://github.com/workscribe/cli/commit/1a13029db8b695902b510bd2b3ed2767924dd168))

## [1.12.0](https://github.com/workscribe/cli/compare/v1.11.0...v1.12.0) (2026-08-22)

### Features

* world-class CLI improvements (W-01) ([7893434](https://github.com/workscribe/cli/commit/7893434945a8c2fa11f48196cebc54d0fa73dcf9))

### Bug Fixes

* improve profile suggest output accuracy ([ac62eb8](https://github.com/workscribe/cli/commit/ac62eb8a0916322e02efae897ba95dfc40bba7e7))

## [1.11.0](https://github.com/workscribe/cli/compare/v1.9.0...v1.11.0) (2026-08-22)

### Features

* improve summary quality and add excluded-events transparency ([4cb38d6](https://github.com/workscribe/cli/commit/4cb38d6f7d5a6b8bccbf0424aced8607e9872630))
* improved init onboarding UX with step indicators, hook explanation, and API key validation ([38008d2](https://github.com/workscribe/cli/commit/38008d219c824d9e3d90db52b77f5674836a14bc))
* **WOR-10:** add workscribe note for session annotations ([1d4a216](https://github.com/workscribe/cli/commit/1d4a216db59fc407d5890d6697594ea72818cf2c))
* **WOR-40:** implement 13-category semantic vocabulary ([73ef6d7](https://github.com/workscribe/cli/commit/73ef6d7dc26268b5e194240cb7957ac0b393206a))
* **WOR-41:** profile pack system with remote registry ([dfd661d](https://github.com/workscribe/cli/commit/dfd661d29d4b54057288af52f6c4a1f9e9f26e39))
* **WOR-9:** add workscribe week command for weekly digest ([567f22b](https://github.com/workscribe/cli/commit/567f22b09e0e75f3898bcf007096ae3df1500af8))

### Bug Fixes

* address three security issues from architectural review ([7ae4a04](https://github.com/workscribe/cli/commit/7ae4a04bd852ec8026a70be89849e724555e2571))
* **F-04:** add actionable Node version guard on startup ([8e56d57](https://github.com/workscribe/cli/commit/8e56d5763276bc30c87154008e58bddaa3b460e4))

## [1.7.2](https://github.com/workscribe/cli/compare/v1.7.1...v1.7.2) (2026-08-09)

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
