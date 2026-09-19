/**
 * French Tarot scoring.
 *
 * The one game here whose score is not counted but computed, from the
 * contract, the oudlers held and the points taken. The arithmetic is
 * mechanical, which is exactly why it belongs in the app rather than in
 * someone's head at eleven at night.
 *
 * The formula, as the French federation states it:
 *
 *     (25 + |écart| + petit au bout) × multiplicateur  + poignée + chelem
 *
 * where the écart is the taker's points minus what the contract required, the
 * petit au bout is worth 10 to whichever side won the last trick with it, and
 * the poignée and chelem bonuses are added afterwards, unmultiplied, to the
 * side that won the deal.
 *
 * The result is zero-sum: what the taker's side gains, the defence loses.
 *
 * Every step is returned in `breakdown` so the players can check the sum at
 * the table — a calculator that cannot be checked is worse than none.
 */

/** What the taker must make, by number of oudlers held (Petit, 21, Excuse). */
export const THRESHOLDS = { 0: 56, 1: 51, 2: 41, 3: 36 };

/** The deck holds 91 points in all. */
export const TOTAL_POINTS = 91;

export const CONTRACTS = [
  { id: 'petite', multiplier: 1 },
  { id: 'garde', multiplier: 2 },
  { id: 'gardeSans', multiplier: 4 },
  { id: 'gardeContre', multiplier: 6 },
];

/** Handfuls of trumps, shown and rewarded to whoever wins the deal. */
export const POIGNEES = [
  { id: 'none', value: 0 },
  { id: 'simple', value: 20 },
  { id: 'double', value: 30 },
  { id: 'triple', value: 40 },
];

export const CHELEMS = [
  { id: 'none', value: 0 },
  { id: 'announcedMade', value: 400 },
  { id: 'announcedFailed', value: -200 },
  { id: 'unannouncedMade', value: 200 },
];

export function contractMultiplier(id) {
  return CONTRACTS.find((contract) => contract.id === id)?.multiplier ?? 1;
}

function valueOf(list, id) {
  return list.find((item) => item.id === id)?.value ?? 0;
}

/**
 * Score one deal.
 *
 * deal = {
 *   takerId, partnerId (5 players, null when the taker called themselves),
 *   contract: 'petite' | 'garde' | 'gardeSans' | 'gardeContre',
 *   oudlers: 0 | 1 | 2 | 3,
 *   points: what the taker took, 0 to 91,
 *   petitAuBout: 'none' | 'taker' | 'defence',
 *   poignee: 'none' | 'simple' | 'double' | 'triple',
 *   chelem: 'none' | 'announcedMade' | 'announcedFailed' | 'unannouncedMade',
 * }
 *
 * Returns { threshold, gap, won, amount, scores, breakdown }, where `scores`
 * is keyed by player id and always adds up to zero.
 */
export function scoreDeal(players, deal) {
  const threshold = THRESHOLDS[deal.oudlers] ?? THRESHOLDS[0];
  const gap = deal.points - threshold;
  const won = gap >= 0;
  const multiplier = contractMultiplier(deal.contract);

  // The petit au bout is worth 10 to the side that took it; seen from the
  // taker, that reduces a loss just as it increases a win.
  const petit = deal.petitAuBout === 'taker' ? 10 : deal.petitAuBout === 'defence' ? -10 : 0;
  const inner = 25 + Math.abs(gap) + (won ? petit : -petit);

  const poignee = valueOf(POIGNEES, deal.poignee);
  const chelem = valueOf(CHELEMS, deal.chelem);

  // Bonuses land outside the multiplication, on the winning side.
  const amount = (won ? 1 : -1) * inner * multiplier + (won ? poignee : -poignee) + chelem;

  const scores = {};
  const partnered = deal.partnerId && deal.partnerId !== deal.takerId;
  for (const player of players) {
    if (player.id === deal.takerId) {
      scores[player.id] = partnered ? 2 * amount : (players.length - 1) * amount;
    } else if (partnered && player.id === deal.partnerId) {
      scores[player.id] = amount;
    } else {
      scores[player.id] = -amount;
    }
  }

  return {
    threshold,
    gap,
    won,
    multiplier,
    amount,
    scores,
    breakdown: {
      threshold,
      points: deal.points,
      gap,
      base: 25,
      petit,
      inner,
      multiplier,
      poignee: won ? poignee : -poignee,
      chelem,
      amount,
    },
  };
}

/** True when the deal can be scored — every field present and sane. */
export function isCompleteDeal(players, deal) {
  if (!deal?.takerId || !players.some((player) => player.id === deal.takerId)) return false;
  if (!CONTRACTS.some((contract) => contract.id === deal.contract)) return false;
  if (![0, 1, 2, 3].includes(deal.oudlers)) return false;
  return Number.isFinite(deal.points) && deal.points >= 0 && deal.points <= TOTAL_POINTS;
}
