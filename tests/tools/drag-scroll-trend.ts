/** Test-process aggregate of read-only samples. Geometry never enters public logs.
 * Sampling is not an event trace: unobserved movement between samples is unknown.
 */
export function createScrollTrend() {
    let previous: number | null = null;
    let samples = 0;
    let increased = false;
    let decreased = false;
    let leftTop = false;
    let returnedToTop = false;
    let unavailable = false;
    return {
        observe(value: number | null) {
            if (value === null || !Number.isFinite(value)) { unavailable = true; return; }
            samples++;
            if (previous !== null) {
                increased ||= value > previous + 0.5;
                decreased ||= value < previous - 0.5;
            }
            returnedToTop ||= leftTop && value <= 1;
            leftTop ||= value > 1;
            previous = value;
        },
        summary() {
            return { scrollTrendSampled: samples >= 2, scrollObservedIncrease: increased,
                scrollObservedDecrease: decreased, scrollObservedAwayFromTop: leftTop,
                scrollObservedReturnToTop: returnedToTop, scrollSampleUnavailable: unavailable };
        }
    };
}
