(function(K) {
  K.procedural.contributionRules = ContributionRules;
  K.procedural.sampleVisibility = SampleVisibility;
  K.procedural.splatCodec = SplatCodec;
  K.procedural.splatOrder = SplatOrder;
  K.stableTransparency = Object.freeze({ history: SplatOrder.history });
})(KIT);
