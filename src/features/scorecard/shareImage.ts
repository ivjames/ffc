import type { CourseSeed, LocalRound } from '../../types';
import { coursePar, playerTotal, formatOverUnder, winners } from '../../lib/scoring';

// Score sharing (punchlist #9 tier 1) — render a branded scorecard image
// entirely client-side (canvas) and hand it to the Web Share API. No backend,
// no photos, no moderation surface: just the numbers the players earned.

const W = 1080;
const H = 1350; // 4:5 — the friendliest crop across share targets

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Render the round as a share image. Resolves to a PNG blob. */
export async function renderShareImage(
  round: LocalRound,
  course: CourseSeed,
  locationName: string | undefined,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');

  const par = coursePar(course.pars);
  const ranked = round.playerTags
    .map((tag, p) => ({ tag, p, total: playerTotal(round.scores[p] ?? []) }))
    .sort((a, b) => a.total - b.total);
  const winnerSet = new Set(winners(round.scores, round.playerTags.length));

  // --- Background: deep green felt with an accent glow top-left.
  ctx.fillStyle = '#0c1f16';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.12, 0, W * 0.2, H * 0.12, W * 0.9);
  glow.addColorStop(0, `${course.accent}33`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Accent top bar.
  ctx.fillStyle = course.accent;
  ctx.fillRect(0, 0, W, 14);

  // --- Header.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px system-ui, sans-serif';
  ctx.fillText('⛳️ MINI GOLF', W / 2, 130);
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.fillStyle = '#b8cfc0';
  const where = locationName ? `${course.name} · ${locationName}` : course.name;
  ctx.fillText(where, W / 2, 195);
  ctx.font = '400 34px system-ui, sans-serif';
  ctx.fillStyle = '#8aa595';
  const played = new Date(round.completedAt ?? round.createdAt);
  ctx.fillText(
    `Par ${par} · ${played.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    W / 2,
    250,
  );

  // Team banner, when the round was played under a team tag.
  let y = 330;
  if (round.groupTag) {
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillStyle = course.accent;
    ctx.fillText(`🏅 TEAM ${round.groupTag}`, W / 2, y);
    y += 70;
  }

  // --- Winner hero card.
  const heroH = 210;
  roundRect(ctx, 80, y, W - 160, heroH, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = `${course.accent}88`;
  ctx.lineWidth = 3;
  roundRect(ctx, 80, y, W - 160, heroH, 28);
  ctx.stroke();

  const hero = ranked.filter((r) => winnerSet.has(r.p));
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.fillStyle = '#8aa595';
  ctx.fillText(hero.length > 1 ? 'TIED FOR THE WIN' : 'WINNER', W / 2, y + 55);
  ctx.font = '900 96px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  const heroLine = `🏆 ${hero.map((r) => r.tag).join(' · ')}`;
  ctx.fillText(heroLine, W / 2, y + 150, W - 220);
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.fillStyle = '#b8cfc0';
  ctx.fillText(
    `${hero[0].total} strokes (${formatOverUnder(hero[0].total - par)})`,
    W / 2,
    y + 195,
  );
  y += heroH + 60;

  // --- Standings rows.
  const rowH = 96;
  ranked.forEach((row, i) => {
    roundRect(ctx, 80, y, W - 160, rowH - 16, 20);
    ctx.fillStyle = winnerSet.has(row.p) ? `${course.accent}2e` : 'rgba(255,255,255,0.05)';
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillStyle = '#66817a';
    ctx.fillText(String(i + 1), 120, y + 54);
    ctx.font = '900 52px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(row.tag, 210, y + 56);

    ctx.textAlign = 'right';
    ctx.font = '800 48px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(row.total), W - 240, y + 56);
    ctx.font = '500 34px system-ui, sans-serif';
    const diff = row.total - par;
    ctx.fillStyle = diff < 0 ? '#4ade80' : diff > 0 ? '#fbbf24' : '#b8cfc0';
    ctx.fillText(formatOverUnder(diff), W - 120, y + 54);
    ctx.textAlign = 'center';
    y += rowH;
  });

  // --- Footer.
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillStyle = '#66817a';
  ctx.fillText("Bullwinkle's · come beat this score", W / 2, H - 70);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/**
 * Share the round image via the Web Share API, falling back to a download
 * when file-sharing isn't available (desktop browsers). Returns how it went
 * out so the UI can word its confirmation.
 */
export async function shareRound(
  round: LocalRound,
  course: CourseSeed,
  locationName: string | undefined,
): Promise<'shared' | 'downloaded'> {
  const blob = await renderShareImage(round, course, locationName);
  const file = new File([blob], 'mini-golf-round.png', { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Mini Golf round' });
      return 'shared';
    } catch (err) {
      // AbortError = the player closed the sheet — not a failure to recover from.
      if ((err as DOMException).name === 'AbortError') return 'shared';
      // Anything else: fall through to the download path.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mini-golf-round.png';
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
