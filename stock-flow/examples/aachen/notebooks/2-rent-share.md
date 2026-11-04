# How much of the rent rise is students

Up to 2020, about three quarters of the model's rent rise comes from students. By 2025 it is less than half, because student numbers fell while the rest of the city grew and households kept getting smaller. These shares barely move when the uncertain settings change. How high rent goes does move, and it depends mostly on one guess.

## Holding one driver still

Three things push demand for flats up: more students, more other residents, and smaller households. Each of these runs holds one of them at its 2000 level and lets the others follow the record.

```chart
title: Rent with each driver held at its 2000 level
scenarios: real, no-student-growth, no-population-growth, no-smaller-households
series: rent
years: 2000–2025
```

The drivers interact, so the share each gets depends on the order you switch them off. The table averages over all orders:

| Rent rise since 2000, in 2000 prices | up to 2015 | up to 2020 | up to 2025 |
|---|---|---|---|
| Total | €0.97 | €1.15 | €1.53 |
| More students | 76% | 76% | 41% |
| More other residents | −19% | −3% | 22% |
| Smaller households | 43% | 27% | 37% |

Other residents count negative up to 2015 because their number dipped slightly between 2010 and 2015, which held rents back.

## How it compares with real rents

The model has no inflation, so it is compared with asking rents in 2000 prices.

```chart
title: Rent in the model and asking rents, both in 2000 prices
scenarios: real
series: rent
data: askingRentReal
years: 2000–2025
```

Real asking rents were flat at the end of the 2000s, then rose 27% from 2010 to 2025. The model rises 17% in those years and sits €0.15 to €0.95 above the data. So it gets the direction and much of the size, but not all of it. Low interest rates and the nationwide rent boom after 2010 aren't in the model. Before 2011 the city's rent figures come from a different data provider, so the early points are less comparable.

## Which guesses matter

The biggest unknown is how many non-student households give up a flat of their own when rents rise: they move in together, stay with their parents a bit longer, or move to a cheaper town. The model assumes a 10% rent rise means 2.4% fewer of them want a flat here. Studies suggest anything from 1% to 4%.

```chart
title: Rent for different household responses
scenarios: real
series: rent
sweep: householdRentElasticity = 0.1, 0.25, 0.4
years: 2000–2040
```

A weaker response raises rent in 2025 to €9.41, a stronger one lowers it to €7.06. How fast builders react hardly matters: switching off building for profit, land shortage or political pressure changes rent in 2025 by a cent at most. In the model, building is mostly limited by the land the city designates, so the price only decides who gets squeezed out.

The students' share is much steadier. Across 1.5 to 2.5 students per flat, 11% to 25% living with parents, builders taking 1.5 to 6 years to spot growth, rents reacting more slowly, and weaker or stronger household responses, students account for 69% to 83% of the rise up to 2020 and 34% to 53% up to 2025. One setting changes it: if 85% of students were registered residents instead of the census's two thirds, the non-student population would be shrinking, and students would account for more than the whole rise up to 2020.
