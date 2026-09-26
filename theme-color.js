(() => {
    const pageThemes = {
        'home-page': '#39BCEC',
        'games-page': '#D65B0D',
        'paint-page': '#082F37',
        'quiz-page': '#351044',
        'monster-page': '#472069'
    };

    function updateThemeColor() {
        const pageClass = Object.keys(pageThemes).find((name) => document.body.classList.contains(name));
        if (!pageClass) return;

        const color = pageThemes[pageClass];
        document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());

        const themeMeta = document.createElement('meta');
        themeMeta.name = 'theme-color';
        themeMeta.content = color;
        document.head.prepend(themeMeta);

        document.documentElement.style.backgroundColor = color;
        document.documentElement.style.setProperty('--page-top-color', color);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateThemeColor, { once: true });
    } else {
        updateThemeColor();
    }

    window.addEventListener('pageshow', updateThemeColor);
    window.addEventListener('focus', updateThemeColor);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateThemeColor();
    });
})();
