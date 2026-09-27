(() => {
    // Apply in browsers and installed apps, before the browser restores a position.
    if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
    }
    const startAtTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.addEventListener('DOMContentLoaded', startAtTop, { once: true });
    window.addEventListener('pageshow', () => {
        startAtTop();
        // Also handle iOS restoring a cached page at the next rendering frame.
        requestAnimationFrame(startAtTop);
    });

    // Keep same-app links in the current window of older iOS Home Screen apps.
    if (!window.navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) return;

    const appRoot = new URL('./', document.currentScript.src);
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== appRoot.origin || !destination.pathname.startsWith(appRoot.pathname)) return;
        if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;

        event.preventDefault();
        window.location.assign(destination.href);
    });
})();
