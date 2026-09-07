// PWM world-side install — paste into Morphic (do-it / eval) once per session.
// Safe to re-run. See pwm/BRIDGE.md.
//
//   Lively.$pwm.install()
//   Lively.$pwm.arm()          // allow agent-authored evals
//   Lively.$pwm.hello()        // smoke: TextMorph on the shared world
//   Lively.$pwm.acceptEval(s)  // run one string if armed
//   Lively.$pwm.disarm()

(function installPwmWorldSide() {
  if (!Lively) throw new Error('PWM: Lively world not ready');

  let pwm = Lively.$pwm || {};
  pwm.armed = !!pwm.armed;
  pwm.log = pwm.log || [];

  pwm.install = function () {
    if (!Lively.pwmInbox) Lively.pwmInbox = [];
    // Drain inbox on a slow step while armed (agent may push strings into the shared array).
    if (!Lively.isStepping || !Lively.isStepping('pwmDrainInbox')) {
      if (Lively.startStepping) Lively.startStepping(250, 'pwmDrainInbox');
    }
    Lively.pwmDrainInbox = function () {
      if (!Lively.$pwm || !Lively.$pwm.armed) return;
      let box = Lively.pwmInbox;
      if (!box || box.length === 0) return;
      let src = box.shift();
      try {
        Lively.$pwm.acceptEval(src);
      } catch (err) {
        Lively.$pwm.log.push('inbox error: ' + err);
        if (typeof console !== 'undefined') console.log('PWM inbox error', err);
      }
    };
    Lively.$pwm = pwm;
    pwm.log.push('installed');
    return pwm;
  };

  pwm.arm = function () {
    pwm.armed = true;
    pwm.log.push('armed');
    return 'PWM armed — agent evals accepted';
  };

  pwm.disarm = function () {
    pwm.armed = false;
    pwm.log.push('disarmed');
    return 'PWM disarmed';
  };

  pwm.acceptEval = function (source) {
    if (!pwm.armed) throw new Error('PWM: disarm — call Lively.$pwm.arm() first');
    let src = '' + source;
    pwm.log.push('eval: ' + src.slice(0, 80));
    // Prefer Morphic’s own eval path when present; else Function in LM global scope.
    if (typeof $eval === 'function') return $eval(src);
    if (typeof eval === 'function') return eval(src);
    throw new Error('PWM: no eval available');
  };

  pwm.hello = function () {
    let wasArmed = pwm.armed;
    pwm.armed = true;
    try {
      return pwm.acceptEval(
        "(() => { let t = new TextMorph(rect(60, 60, 320, 48), 'Hello from Grok 4.5!'); Lively.addMorph(t); return t; })()",
      );
    } finally {
      pwm.armed = wasArmed;
    }
  };

  Lively.$pwm = pwm;
  return pwm.install();
})();
