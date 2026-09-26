(() => {
    const positionPlayButton = () => {
        const characters = document.getElementById('home-characters-image');
        const playButton = document.getElementById('home-play-button');

        if (!characters || !playButton) return;

        playButton.style.setProperty('--home-play-offset-y', '0px');

        const charactersRect = characters.getBoundingClientRect();
        const playRect = playButton.getBoundingClientRect();
        const freeHeight = Math.max(0, window.innerHeight - charactersRect.bottom);
        /* Das Bild wurde 12 px abgesenkt. Der zusätzliche Versatz sorgt
           dafür, dass der Play-Button insgesamt etwa doppelt so weit sinkt. */
        const targetCenter = charactersRect.bottom + freeHeight * 0.27 + 24;
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
