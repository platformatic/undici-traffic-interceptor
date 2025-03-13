# undici-trafficante-interceptor

doc

options: lowercase

if ! response content-length, skip
if trafficante response is err? retry?
! only GET
? trailing slash
? deploy
? github actions

TODO

- abort
- test coverage, options
- NEXT multi-thread hashing

CLEANUP

- types
- remove console.log
- use pino-test.waitFor
