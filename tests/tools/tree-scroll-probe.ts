/**
 * Test-only, instance-scoped observation. No global/prototype mutation.
 * Install through locator.evaluateHandle; keep handle private and dispose in finally.
 * This temporarily shadows an instance method (not literally mutation-free).
 */
export function installTreeScrollProbe(tree: any) {
    const unavailable = () => ({ available: false, connected: false, methodIntact: false,
        windowObserved: false, requestObserved: false, eventObserved: false, movementObserved: false,
        increaseObserved: false, decreaseObserved: false, requestThrew: false });
    if (!tree || typeof tree.scrollTo !== 'function' || typeof tree.addEventListener !== 'function') return null;
    const own = Object.getOwnPropertyDescriptor(tree, 'scrollTo');
    if (own && (!own.configurable || !('value' in own))) return null;
    const native = tree.scrollTo;
    let disposed = false, started = false;
    let requests = 0, events = 0, moves = 0, increases = 0, decreases = 0, errors = 0;
    let last = tree.scrollTop;
    let baseline = [0, 0, 0, 0, 0, 0];
    function wrapper(this: any, ...args: any[]) {
        if (this !== tree || disposed) return Reflect.apply(native, this, args);
        requests++;
        try { return Reflect.apply(native, this, args); }
        catch (error) { errors++; throw error; }
    }
    const onScroll = () => {
        events++;
        const current = tree.scrollTop;
        if (Number.isFinite(current) && Number.isFinite(last) && current !== last) {
            moves++; if (current > last) increases++; else decreases++;
        }
        last = current;
    };
    try {
        Object.defineProperty(tree, 'scrollTo', own ? { ...own, value: wrapper }
            : { value: wrapper, configurable: true, writable: true, enumerable: false });
        tree.addEventListener('scroll', onScroll, { passive: true });
    } catch {
        if (Object.getOwnPropertyDescriptor(tree, 'scrollTo')?.value === wrapper) {
            if (own) Object.defineProperty(tree, 'scrollTo', own);
            else delete tree.scrollTo;
        }
        return null;
    }
    return {
        begin() {
            if (disposed) return;
            baseline = [requests, events, moves, increases, decreases, errors];
            last = tree.scrollTop; started = true;
        },
        summary() {
            if (disposed) return unavailable();
            const intact = Object.getOwnPropertyDescriptor(tree, 'scrollTo')?.value === wrapper;
            const observed = started && tree.isConnected === true && intact;
            return { available: true, connected: tree.isConnected === true, methodIntact: intact,
                windowObserved: observed, requestObserved: observed && requests > baseline[0],
                eventObserved: observed && events > baseline[1], movementObserved: observed && moves > baseline[2],
                increaseObserved: observed && increases > baseline[3], decreaseObserved: observed && decreases > baseline[4],
                requestThrew: observed && errors > baseline[5] };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            tree.removeEventListener('scroll', onScroll);
            // Never overwrite a later replacement owned by the app/another observer.
            if (Object.getOwnPropertyDescriptor(tree, 'scrollTo')?.value === wrapper) {
                if (own) Object.defineProperty(tree, 'scrollTo', own);
                else delete tree.scrollTo;
            }
        }
    };
}
