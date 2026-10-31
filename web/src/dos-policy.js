import {DOS_KEY_IDS, emptyDosInput, validateDosInput} from './dos-input.js';

export const defaultDosPolicy = (blocked = []) => ({revision: 0, mode: 'shared', owner: 0, blocked});
export function validateDosPolicy(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > 1e9 ||
      !['shared', 'turns'].includes(value.mode) || ![0, 1].includes(value.owner) ||
      !Array.isArray(value.blocked) || value.blocked.length > 128 ||
      value.blocked.some(key => !DOS_KEY_IDS.has(key)) || new Set(value.blocked).size !== value.blocked.length) {
    throw new Error('Ongeldige DOS-toetsverdeling.');
  }
  return {revision: value.revision, mode: value.mode, owner: value.owner, blocked: [...value.blocked].sort((a,b) => a-b)};
}
export function nextDosPolicy(policy, change) {
  return validateDosPolicy({...policy, ...change, revision: policy.revision + 1});
}
export function canPassDosControl(policy, player) {
  return policy.mode === 'turns' && policy.owner === player;
}
export function validDosReturn(policy, request, epoch) {
  return canPassDosControl(policy, 1) && request.revision === policy.revision && request.epoch === epoch;
}
export function filterDosInput(input, policy, player) {
  const state = validateDosInput(input);
  if (policy.mode === 'turns') return policy.owner === player ? state : emptyDosInput();
  if (player === 0) return state;
  const blocked = new Set(policy.blocked);
  state.keys = state.keys.filter(key => !blocked.has(key));
  // Modifier metadata and wheel-to-PageUp/Down must not bypass reserved keys.
  const has = (...keys) => keys.some(key => state.keys.includes(key));
  state.modifiers = (has(303,304)?1:0) | (has(305,306)?2:0) | (has(307,308)?4:0) | (has(309,310)?8:0) |
    (blocked.has(300)?0:state.modifiers&16) | (blocked.has(301)?0:state.modifiers&32) | (blocked.has(302)?0:state.modifiers&64);
  if (state.mouse.wheel < 0 && blocked.has(280) || state.mouse.wheel > 0 && blocked.has(281)) state.mouse.wheel = 0;
  return state;
}
// Apply immediately before emulation, including to previously queued inputs.
// A mode/owner change has one neutral frame; ordinary reservations leave
// unrelated held keys intact.
export class DosPolicyFilter {
  constructor(policy = defaultDosPolicy()) { this.policy = validateDosPolicy(policy); }
  apply(inputs, value) {
    const policy = validateDosPolicy(value);
    if (policy.revision < this.policy.revision) throw new Error('Verouderde DOS-toetsverdeling.');
    if (policy.revision === this.policy.revision && JSON.stringify(policy) !== JSON.stringify(this.policy)) throw new Error('Tegenstrijdige DOS-toetsverdeling.');
    const handoff = policy.mode !== this.policy.mode || policy.owner !== this.policy.owner;
    this.policy = policy;
    if (handoff) return [emptyDosInput(), emptyDosInput()];
    const states = inputs.map((input, player) => filterDosInput(input, policy, player));
    // In turn mode the active person's gamepad controls DOS joystick 1.
    return policy.mode === 'turns' ? [states[policy.owner], emptyDosInput()] : states;
  }
}
