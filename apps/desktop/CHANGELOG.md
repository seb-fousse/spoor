# Changelog

## [0.2.0](https://github.com/seb-fousse/spoor/compare/desktop-v0.1.0...desktop-v0.2.0) (2026-11-14)


### Features

* **core:** add logs slice ([#43](https://github.com/seb-fousse/spoor/issues/43)) ([a913ab7](https://github.com/seb-fousse/spoor/commit/a913ab75c9d6cc88c8f612f4e5422cbd77dae7b8))
* **core:** add observations slice ([#41](https://github.com/seb-fousse/spoor/issues/41)) ([b9e9cef](https://github.com/seb-fousse/spoor/commit/b9e9cefd89606e23be593df081acbcff84edde76))
* **core:** add things slice ([#42](https://github.com/seb-fousse/spoor/issues/42)) ([99e06bf](https://github.com/seb-fousse/spoor/commit/99e06bf2075086916f8c332c5f00daaa79e828ca))
* **core:** add versioned migration runner ([#28](https://github.com/seb-fousse/spoor/issues/28)) ([a2accb1](https://github.com/seb-fousse/spoor/commit/a2accb1b5a0a6ed0147aabe71dd1f8cb260ed5e3))
* **desktop:** add a logs list and new-log modal to the Home rail ([#112](https://github.com/seb-fousse/spoor/issues/112)) ([a1ca463](https://github.com/seb-fousse/spoor/commit/a1ca463bf4f1bab3dadf9c0773c7890d572c72ba))
* **desktop:** add bottom bar, warm theme, and fluid splitter home layout ([#99](https://github.com/seb-fousse/spoor/issues/99)) ([91d279c](https://github.com/seb-fousse/spoor/commit/91d279cf5325c2a9ea992cf280808a7e09b50007))
* **desktop:** add Mantine provider, theme and app shell ([#56](https://github.com/seb-fousse/spoor/issues/56)) ([56104f6](https://github.com/seb-fousse/spoor/commit/56104f691e1d0e9b2c743dd9568b16c4a25b9d6d))
* **desktop:** add proof-of-concept timelines screen ([#35](https://github.com/seb-fousse/spoor/issues/35)) ([cde9b25](https://github.com/seb-fousse/spoor/commit/cde9b257d13c95824d8f79f9654d79737f849396))
* **desktop:** add SQLite execute/query commands ([#21](https://github.com/seb-fousse/spoor/issues/21)) ([1c30719](https://github.com/seb-fousse/spoor/commit/1c3071954dbbd24bbb328edce65e072e5ab64170))
* **desktop:** copy a timeline block and paste it elsewhere ([#134](https://github.com/seb-fousse/spoor/issues/134)) ([2295a62](https://github.com/seb-fousse/spoor/commit/2295a628e1f6e9ceb438414bc0238f90a30bc167))
* **desktop:** delete a selected timeline block with the Delete key ([#133](https://github.com/seb-fousse/spoor/issues/133)) ([3588e02](https://github.com/seb-fousse/spoor/commit/3588e029910b286088442725dd7097e99e1442a4))
* **desktop:** delete a timeline block without a confirmation ([#136](https://github.com/seb-fousse/spoor/issues/136)) ([7381fdb](https://github.com/seb-fousse/spoor/commit/7381fdba2592171b05ae91590ef3a84d58c5e9fe))
* **desktop:** drag to create a timeline block with a category popover ([#127](https://github.com/seb-fousse/spoor/issues/127)) ([cfa5a7f](https://github.com/seb-fousse/spoor/commit/cfa5a7fdb6df4c19245bfd2b4dab93aafdf5c476))
* **desktop:** implement Database seam over Tauri IPC ([#22](https://github.com/seb-fousse/spoor/issues/22)) ([a729d85](https://github.com/seb-fousse/spoor/commit/a729d85446cfa13bdd7b72d4530c515399c03276))
* **desktop:** move, resize, recategorize, split and delete timeline blocks ([#128](https://github.com/seb-fousse/spoor/issues/128)) ([c5c166f](https://github.com/seb-fousse/spoor/commit/c5c166fb7f4c71745dd3ac0ea06940e9d1dcfb19))
* **desktop:** port Logs screen to Mantine ([#60](https://github.com/seb-fousse/spoor/issues/60)) ([b89fad8](https://github.com/seb-fousse/spoor/commit/b89fad8c5d54de0be81e74e9f89060b29a293d58))
* **desktop:** port Observations screen to Mantine ([#58](https://github.com/seb-fousse/spoor/issues/58)) ([bbbbfcc](https://github.com/seb-fousse/spoor/commit/bbbbfccc44b09cc619dcf1a4841d4de891903d30))
* **desktop:** port Things screen to Mantine ([#59](https://github.com/seb-fousse/spoor/issues/59)) ([42a5b03](https://github.com/seb-fousse/spoor/commit/42a5b033b6a6712912f4a65f640be8ce9f33d0a1))
* **desktop:** port Timelines screen to Mantine ([#61](https://github.com/seb-fousse/spoor/issues/61)) ([9fd4995](https://github.com/seb-fousse/spoor/commit/9fd4995153b49f092877eed878c2aa8548f11277))
* **desktop:** restyle the timeline blocks on Home's grid ([#130](https://github.com/seb-fousse/spoor/issues/130)) ([48df9fe](https://github.com/seb-fousse/spoor/commit/48df9fe01a9d289dd78380a538220c1597f58e3f))
* **desktop:** scaffold out page layout ([#94](https://github.com/seb-fousse/spoor/issues/94)) ([432128f](https://github.com/seb-fousse/spoor/commit/432128fa5aab3cb45aa61bb566e336ffde2448d7))
* **desktop:** split the selected timeline block with the C key ([#138](https://github.com/seb-fousse/spoor/issues/138)) ([7de576c](https://github.com/seb-fousse/spoor/commit/7de576c6f1e54b536882ac8ff523fdc260fb7ab6))
* **desktop:** style fields, modal, button and alert in the blueprint look ([#111](https://github.com/seb-fousse/spoor/issues/111)) ([a9e43c7](https://github.com/seb-fousse/spoor/commit/a9e43c7b8fcb2f0ae5e58c85f2e2bdcd47fe68a8))
* **desktop:** use Mantine date pickers for the remaining date inputs ([#65](https://github.com/seb-fousse/spoor/issues/65)) ([3c53566](https://github.com/seb-fousse/spoor/commit/3c535663b8670f1cab854f4e31eaa304c7f52afc))
* **home:** add a timeline filter to the grid ([#113](https://github.com/seb-fousse/spoor/issues/113)) ([9c51e3b](https://github.com/seb-fousse/spoor/commit/9c51e3ba161bae84e9ca2566f6d83b534d2cf30d))
* **home:** add active-day state, date paging and range toggle ([#101](https://github.com/seb-fousse/spoor/issues/101)) ([e8df834](https://github.com/seb-fousse/spoor/commit/e8df8343111d1208e41ffe7f8352d190eb7fcb80))
* **home:** add observation cards to the Home rail ([#107](https://github.com/seb-fousse/spoor/issues/107)) ([7828e97](https://github.com/seb-fousse/spoor/commit/7828e972be42cb3b71eec8e6e6d63f7081c64d51))
* **home:** add read-only timeline grid ([#103](https://github.com/seb-fousse/spoor/issues/103)) ([688ef23](https://github.com/seb-fousse/spoor/commit/688ef2364d2f65c155c4326652547c1a6bdc23c2))
* **home:** select and highlight the active day in the timeline grid ([#104](https://github.com/seb-fousse/spoor/issues/104)) ([272ed52](https://github.com/seb-fousse/spoor/commit/272ed52d3e00899725e4771ae5250eb83a436640))
* **home:** show observation completeness badges on grid day headers ([#108](https://github.com/seb-fousse/spoor/issues/108)) ([2f84d12](https://github.com/seb-fousse/spoor/commit/2f84d12b47b34e22d7584480f4112ce7d5063a65))
* **theme:** integrate Mantine styling scaffold ([#96](https://github.com/seb-fousse/spoor/issues/96)) ([7e720cf](https://github.com/seb-fousse/spoor/commit/7e720cf3906af6498ac647754b4573bf11520da3))


### Bug Fixes

* **desktop:** keep Home's active day and window when leaving Home ([#106](https://github.com/seb-fousse/spoor/issues/106)) ([dcf9fae](https://github.com/seb-fousse/spoor/commit/dcf9fae0c74e7da09efa922943e03ef641828584))


### Performance Improvements

* **desktop:** keep database queries fresh until a write invalidates them ([#125](https://github.com/seb-fousse/spoor/issues/125)) ([9e2a455](https://github.com/seb-fousse/spoor/commit/9e2a45503d99f1cb17b0590e0c83ba92826fc7a2))
