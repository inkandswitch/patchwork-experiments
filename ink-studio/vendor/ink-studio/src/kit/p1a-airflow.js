/* Shared airflow kernel for procedural materials and renderers. */
(function (K) {
  const P = K.procedural || K.authoring;
  P.airflow = Object.freeze({ ...Airflow,
    field(settings = true, source) {
      const config = WindField.settings(settings);
      return config && WindField.create(config,source);
    }
  });
})(KIT);
