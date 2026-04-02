# Changelog

## [0.3.4](https://github.com/grayashh/buddy-reroll/compare/v0.3.3...v0.3.4) (2026-04-02)


### Bug Fixes

* harden all user-facing code paths against corruption, exit, and data loss ([653b29c](https://github.com/grayashh/buddy-reroll/commit/653b29ca173056c3fccd66e50a5dcc965dc86f8e))
* production hardening — rollback-safe patch, atomic config writes, cancel-safe search ([3169fb9](https://github.com/grayashh/buddy-reroll/commit/3169fb98796ca0fdf147ae330b18f95baa497127))

## [0.3.3](https://github.com/grayashh/buddy-reroll/compare/v0.3.2...v0.3.3) (2026-04-02)


### Bug Fixes

* use correct Claude Code hook format (matcher+hooks object), auto-fix permissions in --doctor ([f71315c](https://github.com/grayashh/buddy-reroll/commit/f71315ca2ee91bff3a390acd92a56edc75116139))

## [0.3.2](https://github.com/grayashh/buddy-reroll/compare/v0.3.1...v0.3.2) (2026-04-02)


### Bug Fixes

* preserve file permissions after patch, force exit on DoneStep keypress ([8cb32c3](https://github.com/grayashh/buddy-reroll/commit/8cb32c3bc39b242302a065cbc5b60b0b5697c12f))

## [0.3.1](https://github.com/grayashh/buddy-reroll/compare/v0.3.0...v0.3.1) (2026-04-02)


### Bug Fixes

* deep review — interactive parallel search, state machine gaps, estimator bug, terminology ([f310335](https://github.com/grayashh/buddy-reroll/commit/f3103357f53a277df1f45f8eb08c6f40a79df465))
* patch verification, auto-hook by default, friendlier messages, worker error reporting ([2994335](https://github.com/grayashh/buddy-reroll/commit/299433570542802e30242cc89f976363a27b9592))

## [0.3.0](https://github.com/grayashh/buddy-reroll/compare/v0.2.1...v0.3.0) (2026-04-02)


### Features

* multi-worker search, stats customization, auto-patch hooks, Node.js interactive fallback ([6b9a89a](https://github.com/grayashh/buddy-reroll/commit/6b9a89a0c824093b645f9eaa23675d0d789c9a67))

## [0.2.1](https://github.com/grayashh/buddy-reroll/compare/v0.2.0...v0.2.1) (2026-04-01)


### Bug Fixes

* Windows compatibility, UI bugs, code cleanup ([2db4c95](https://github.com/grayashh/buddy-reroll/commit/2db4c95e8d50b42e136916bc78c211726a248e9b))

## [0.2.0](https://github.com/grayashh/buddy-reroll/compare/v0.1.1...v0.2.0) (2026-04-01)


### Features

* add Ink-based interactive UI with persistent sprite preview ([3247d17](https://github.com/grayashh/buddy-reroll/commit/3247d17bc2e074a237785f0c6d116dff4e041ef4))

## [0.1.1](https://github.com/grayashh/buddy-reroll/compare/v0.1.0...v0.1.1) (2026-04-01)


### Bug Fixes

* salt detection, Bun runtime check, process detection, config path ([e316416](https://github.com/grayashh/buddy-reroll/commit/e3164167b68101e02e14e128c33d2349d30050e2))
