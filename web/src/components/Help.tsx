import { useEffect } from 'react';
import { PixelText } from './PixelText.tsx';
import { PixelIcon } from './PixelIcon.tsx';
import type { IconName } from '../lib/icons.ts';
import { C, PLATFORM_LABEL, RATING_COLOR, SERIES_COLOR, platformText, type Dashboard, type Platform } from '../lib/data.ts';

const W = Math.min(typeof window === 'undefined' ? 800 : window.innerWidth - 96, 760);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="help-section">
      <PixelText text={title} px={3} color={C.green} />
      {children}
    </section>
  );
}

/** One line of help; `swatch` puts a colour square in front. */
function Line({ text, swatch, color = C.fg }: { text: string; swatch?: string; color?: string }) {
  return (
    <div className="help-line">
      {swatch && <i style={{ background: swatch }} />}
      <PixelText text={text} px={2} color={color} maxWidth={W - (swatch ? 24 : 0)} />
    </div>
  );
}

const PLATFORMS: Platform[] = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'reddit', 'github'];

/**
 * HOW IT WORKS: everything the dashboard means, in one place, so the panels can show only
 * numbers. Point values and thresholds come from the server's own rules.
 */
export function Help({ data, onClose }: { data: Dashboard; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const r = data.rules;
  const [hot, good, meh] = r.ratingThresholds.map(([, x]) => x);
  const weights = (group: 'build' | 'maintain') =>
    r.githubWeights.filter((w) => w.group === group).map((w) => `${w.label} ${w.weight}`).join(', ');

  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help" role="dialog" aria-modal="true" aria-label="How it works">
        <header className="help-head">
          <PixelText text="HOW IT WORKS" px={5} scan />
          <button onClick={onClose} aria-label="Close">
            <PixelText text="× CLOSE" px={2} />
          </button>
        </header>

        <Section title="ICONS">
          <div className="help-chips">
            {([
              ['heart', 'ENGAGEMENT, LIKES'],
              ['comment', 'COMMENTS, DISCUSSIONS'],
              ['share', 'SHARES, REPOSTS'],
              ['eye', 'VIEWS, REACH'],
              ['followers', 'FOLLOWERS'],
              ['star', 'GITHUB STARS'],
              ['build', 'BUILD'],
              ['maintain', 'MAINTAIN'],
              ['commit', 'COMMITS'],
              ['pr', 'PULL REQUESTS'],
              ['issue', 'ISSUES'],
              ['check', 'CLOSED, REVIEWED, ANSWERED'],
              ['fork', 'FORKS'],
              ['tag', 'RELEASES'],
            ] as [IconName, string][]).map(([icon, label]) => (
              <span key={icon}>
                <PixelIcon name={icon} px={2} />
                <PixelText text={label} px={2} color={C.gray} />
              </span>
            ))}
          </div>
        </Section>

        <Section title="THE SCORE">
          <Line text="ONE BAR PER DAY, STACKED BY SERIES, IN POINTS. TOTAL SHOWS THE RUNNING SUM INSTEAD." />
          <Line swatch={SERIES_COLOR.linkedin} text="POSTS: ENGAGEMENT GAINED. A LIKE OR UPVOTE IS 1, A COMMENT 2, A SHARE 3. A POST'S FIRST READING COUNTS ON THE DAY IT WENT OUT." />
          <Line swatch={SERIES_COLOR.build} text={`BUILD: ${weights('build')} POINTS EACH.`} />
          <Line swatch={SERIES_COLOR.maintain} text={`MAINTAIN: ${weights('maintain')} POINTS EACH.`} />
          <Line swatch={SERIES_COLOR.stars} text={`STARS: ${r.starPoints} PER NEW STAR ON A TRACKED REPOSITORY, EXACT PER DAY.`} />
          <Line swatch={SERIES_COLOR.followers} text={`FOLLOWERS: ${r.followerPoints} PER NEW FOLLOWER ON ANY PLATFORM. LOSSES COUNT AS ZERO.`} />
          <Line text="THE CHANGE COMPARES WITH THE PERIOD BEFORE. NO BASELINE YET MEANS THAT PERIOD HAS NO COMPLETE DATA. A DASH MEANS THE SAME FOR ONE SERIES." color={C.gray} />
          <Line text="S SOLOS A SERIES (ONLY SOLOED SERIES SHOW), M MUTES IT, CLICKING AGAIN RETURNS IT TO NORMAL, RESET CLEARS ALL. THE TOTAL, THE BARS AND THE CITY FOLLOW." color={C.gray} />
        </Section>

        <Section title="THE CITY">
          <Line text="EVERY TOWER IS A POST, PLACED BY DATE AROUND THE RING; NOW IS THE GAP. HEIGHT IS LINEAR IN ENGAGEMENT, SCALED TO THE BIGGEST POST IN VIEW." />
          <Line text="EACH PLATFORM STANDS ON ITS OWN RING, IN ITS COLOUR:" />
          <div className="help-chips">
            {PLATFORMS.map((p) => (
              <span key={p}>
                <i style={{ background: platformText(p) }} />
                <PixelText text={PLATFORM_LABEL[p]} px={2} color={platformText(p)} />
              </span>
            ))}
          </div>
          <Line text="A TOWER'S LOOK IS HOW THE POST DOES AGAINST THE SAME ACCOUNT'S LAST 10 POSTS, WITH ITS ENGAGEMENT SO FAR PROJECTED TO A LIFETIME TOTAL:" />
          <Line swatch={RATING_COLOR.hot} text={`HOT, ${hot}X USUAL OR MORE: ON FIRE WITH A FLAME ON TOP.`} />
          <Line swatch={RATING_COLOR.good} text={`GOOD, ${good}X OR MORE: GREEN ENERGY CLIMBING.`} />
          <Line swatch={RATING_COLOR.meh} text={`MEH, ${meh}X OR MORE: FROZEN.`} />
          <Line swatch={RATING_COLOR.shit} text={`SHIT, BELOW ${meh}X: GREY AND CRACKED, WITH A SKULL; THREE SKULLS BELOW HALF OF THAT.`} />
          <Line text="PLAIN STRIPES: NOT RATED YET (THE ACCOUNT NEEDS 3 EARLIER POSTS). EARLY: YOUNGER THAN ITS PLATFORM'S ENGAGEMENT WINDOW, SO MOSTLY PROJECTION." color={C.gray} />
          <Line swatch={C.yellow} text="YELLOW RIPPLES AT THE BASE: POSTED IN THE LAST 48 HOURS." />
          <Line text="CLICK A TOWER TO SHOW ITS POST, CLICK IT AGAIN TO OPEN IT; ESC OR A CLICK ON EMPTY SPACE CLOSES IT. DRAG TO SPIN, SCROLL OR PINCH TO ZOOM." color={C.gray} />
        </Section>

        <Section title="THE RING, THE STARS, THE PLANETS">
          <Line swatch={C.green} text="THE OUTER RING IS A YEAR OF GITHUB, ONE COLUMN PER DAY: BUILD IN GREEN BELOW, MAINTAIN IN ORANGE ON TOP." />
          <Line swatch={C.fg} text="EACH PERSON IS A COIN WITH THEIR PHOTO. THEIR PLATFORMS ORBIT AS MOONS SIZED BY FOLLOWERS, LABELLED WITH FOLLOWERS AND THE 7-DAY CHANGE." />
          <Line text="A TRACKED REPOSITORY FLOATS ABOVE THE CITY AS A STAR: ONE TINY STAR ORBITS IT FOR EACH STAR GAINED IN RANGE, AND TODAY'S STARS FALL IN AS SHOOTING STARS." color={C.gray} />
        </Section>

        <Section title="DATA">
          <Line text={`COLLECTED ONCE A DAY AT ${r.dailyAt}. REFRESH COLLECTS ONLY WHO IS ON SCREEN.`} />
          <Line text="POSTS ARE RE-READ DAILY FOR A WEEK, EVERY THIRD DAY WHILE STILL GROWING, AND NOT AT ALL AFTER 30 DAYS." />
          <Line text={`ENGAGEMENT WINDOWS: ${Object.entries(r.engagementHours).map(([p, h]) => `${p.toUpperCase()} ${h}H`).join(', ')}.`} color={C.gray} />
          <Line text="EVERY READING IS KEPT, NOTHING IS OVERWRITTEN. TRENDS NEED 14 DAYS OF READINGS." color={C.gray} />
          <Line text="REACH COUNTS VIEWS, OR PEOPLE WHO ENGAGED WHERE A PLATFORM SHOWS NO VIEWS. LINKEDIN SHOWS IMPRESSIONS ONLY TO THE AUTHOR, SO ITS VIEWS COUNT ONCE AN ANALYTICS EXPORT IS IMPORTED." color={C.gray} />
        </Section>

        <Section title="CONTROLS">
          <Line text="CLICK THE NAME TO SWITCH PERSON OR GROUP. DETAILS SHOWS THE BREAKDOWNS AND THE RANGE." />
          <Line text="CINEMA, OR 30 SECONDS WITHOUT INPUT, STARTS A CAMERA TOUR. MOVE THE MOUSE TO RETURN." />
        </Section>
      </div>
    </div>
  );
}
