# Scenarios

Every chart in the notebooks runs one of these named scenarios, never the sliders, so a finding doesn't change when someone moves a slider. **Open in model** loads a scenario into the controls; **Save model as scenario** (while editing) turns the current controls into a new one.

The curves show each input's yearly multiplier against the balanced value of 1 (dashed). Hover over a curve for its values.

```scenario
real
no-student-growth
no-population-growth
no-smaller-households
no-surge
forecast-low
forecast-high
balanced
no-new-students
student-flood
no-new-land
real-instant
real-half-step
```

The model tests that use the last six are in "Switching loops off".

## Writing a chart

````
```chart
title: Rent for different household responses
scenarios: real
series: rent
data: askingRentReal
sweep: householdRentElasticity = 0.1, 0.25, 0.4
years: 2010–2030
guide: 3 normal vacancy
```
````

- **scenarios**: one or more scenario ids. Add `without supply and policy` to knock out loops: supply, spillover, land, policy, pipeline.
- **series**: model variables, such as rent, students, studentsInMarket, otherHouseholds, flats or completions. Up to two units per chart.
- **data**: real series to overlay, such as askingRentReal, students.cityDefinition, vacancyRateAdjusted or completions.
- **sweep**: one line per value of a parameter, delay, loop strength or dt, for a single scenario.
