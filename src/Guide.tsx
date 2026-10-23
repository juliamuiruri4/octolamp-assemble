import { useState } from 'react';
import { VIDEO_ID } from './build';

export default function Guide() {
  const [playing, setPlaying] = useState(false);
  return (
    <section className="page" aria-labelledby="guide-title">
      <h1 id="guide-title" tabIndex={-1}>Guide</h1>
      <div className="video">
        {playing ? (
          <iframe
            title="Octolamp assembly walkthrough"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="play" onClick={() => setPlaying(true)}>
            <span aria-hidden="true" className="play-icon" />
            <span className="play-label">Play walkthrough</span>
          </button>
        )}
      </div>
      <ul className="links">
        <li><a href="https://github.com/martinwoodward/octolamp/blob/main/UNIVERSE_ASSEMBLY.md">Written guide</a></li>
        <li><a href="https://kno.wled.ge/">WLED</a></li>
        <li><a href="https://www.home-assistant.io/integrations/wled/">Home Assistant</a></li>
        <li><a href="https://github.com/martinwoodward/octolamp/discussions/categories/show-and-tell">Share your make</a></li>
      </ul>
    </section>
  );
}
