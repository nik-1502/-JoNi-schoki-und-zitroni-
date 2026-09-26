(() => {
    const positionPlayButton = () => {
        const hero = document.querySelector('.home-page .hero-container');
        const characters = document.getElementById('home-characters-image');
        const playButton = document.getElementById('home-play-button');
        const playGraphic = playButton?.querySelector('img');

        if (!hero || !characters || !playButton || !playGraphic) return;

        hero.style.setProperty('--home-hero-offset-y', '0px');
        playButton.style.setProperty('--home-play-offset-y', '0px');

        const initialCharactersRect = characters.getBoundingClientRect();
        const heroOffset = window.innerHeight / 2
            - (initialCharactersRect.top + initialCharactersRect.height / 2);
        hero.style.setProperty('--home-hero-offset-y', `${heroOffset}px`);

        const charactersRect = characters.getBoundingClientRect();
        const playRect = playButton.getBoundingClientRect();
        const playGraphicRect = playGraphic.getBoundingClientRect();
        const freeHeight = Math.max(0, window.innerHeight - charactersRect.bottom);
        const distanceToCenter = Math.max(
            playGraphicRect.height / 2 + 8,
            freeHeight * 0.18
        );
        const targetCenter = charactersRect.bottom + distanceToCenter;
        const currentCenter = playRect.top + playRect.height / 2;

        playButton.style.setProperty(
            '--home-play-offset-y',
            `${targetCenter - currentCenter}px`
        );
    };

    let frame;
    const schedulePosition = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(positionPlayButton);
    };

    window.addEventListener('load', schedulePosition);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('pageshow', schedulePosition);

    document.addEventListener('DOMContentLoaded', () => {
        const characters = document.getElementById('home-characters-image');
        if (characters && !characters.complete) {
            characters.addEventListener('load', schedulePosition, { once: true });
        }
        schedulePosition();
    });
})();
