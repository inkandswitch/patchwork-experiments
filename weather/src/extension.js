// The weather extension (WEATHER.md): the `weather` scene trait offered as
// the world's `wind` and `atmosphere` ambients (scene STAGE.md, "Ambients").
//
// W0, the scaffold: it runs where the trait is and offers nothing yet, so a
// doc carrying it changes no world. The ambients arrive with the sun (solar.js)
// and the sky (atmosphere.js).

export default {
  create() {
    return {
      ambient() {
        return null;
      },
    };
  },
};
