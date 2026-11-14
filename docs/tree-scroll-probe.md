# Instance-scoped scroll diagnostics
The coordinate sibling reorder test observes only its exact #dom-tree element.
A temporary own scrollTo wrapper forwards receiver, argument references, return
value and thrown error unchanged using Reflect.apply. No global/prototype hooks,
forced scroll, timing waits or acceptance changes. This is observational
instrumentation, not literally mutation-free: method identity temporarily changes.
A passive element scroll listener compares positions privately.

All ten probe fields are fixed booleans and validated by the existing safe reporter.
Before-assert records the reorder window; then counters reset so assertion-failed
covers only the original assertion wait. Missing/replaced/detached targets report
windowObserved=false. No raw position, arguments, errors or counters are reported.
Finally removes the listener/restores the exact original own descriptor; a later
app replacement is never overwritten.

Request without movement distinguishes native requests from observed movement.
No requests cannot distinguish timer inactivity from early return inside the
controller. This observer does not intercept cached old method references or
a different/replaced tree. It requires no staging source/SHA change.

Validation: dedicated forwarding/restoration tests plus full offline suite.
Separate synthetic real-editor WebKit comparison observed the same successful
final sibling marker/count/order with observer on and off. This is not proof of
zero timing effect and does not replace staged CI acceptance.
