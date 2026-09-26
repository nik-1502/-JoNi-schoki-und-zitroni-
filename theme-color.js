(() => {
    const pageThemes = {
        'home-page': '#7DD5FB',
        'games-page': '#D65B0D',
        'paint-page': '#082F37',
        'quiz-page': '#351044',
        'monster-page': '#54247B'
    };

    function updateThemeColor() {
        const pageClass = Object.keys(pageThemes).find((name) => document.body.classList.contains(name));
        if (!pageClass) return;

        let themeMeta = document.querySelector('meta[name="theme-color"]');
        if (!themeMeta) {
            themeMeta = document.createElement('meta');
            themeMeta.name = 'theme-color';
            document.head.appendChild(themeMeta);
        }

        const color = pageThemes[pageClass];
        themeMeta.content = color;
        document.documentElement.style.backgroundColor = color;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateThemeColor, { once: true });
    } else {
        updateThemeColor();
    }

    window.addEventListener('pageshow', updateThemeColor);
})();
