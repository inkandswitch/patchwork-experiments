/* Opt-in near-field shadow settings for baked and posed surfaces. */
const ContactShadows = (() => {
  const shadows = typeof ShadowArt === 'undefined' ? require('./shadow-art.js') : ShadowArt;

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !['reach', 'strength', 'cast', 'receive'].includes(key)))
      throw new TypeError('Contact shadows need a boolean or settings with reach, strength, cast and receive');
    const { reach = .36, strength = .48, cast, receive } = value;
    if (!Number.isFinite(reach) || reach <= 0 || !Number.isFinite(strength) || strength < 0 || strength > 1)
      throw new RangeError('Contact shadow reach must be positive and strength must be between 0 and 1');
    const masks = shadows.prepare({ cast, receive });
    return strength > 0 ? Object.freeze({ reach, strength, cast: masks?.cast, receive: masks?.receive }) : null;
  }

  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = ContactShadows;
