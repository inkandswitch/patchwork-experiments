// Example sheets, offered when a sheet is empty. Each is { address: cell text }.

export interface Example {
  name: string;
  blurb: string;
  cells: Record<string, string>;
}

export const examples: Example[] = [
  {
    name: 'Monthly budget',
    blurb: 'Two cars × three apartments: six scenarios, all of them checked.',
    cells: {
      A1: 'Monthly budget',
      A3: 'Car',
      B3: 'car = {500, 1200}',
      A4: 'Apartment',
      B4: 'apartment = {2800, 3700, 4200}',
      A5: 'Netflix',
      B5: '18',
      A7: 'TOTAL',
      B7: 'total = SUM(B3:B5)',
      A8: 'Can afford?',
      B8: '=total <= 4200',
    },
  },
  {
    name: 'Wedding',
    blurb: 'Venue, day and guest list. Filter on the total to see which choices fit a budget.',
    cells: {
      A1: 'Wedding',
      A3: 'Venue',
      B3: 'venue = {"Library", "Yacht club", "Barn"}',
      A4: 'Day',
      B4: 'day = {"Weekday", "Weekend"}',
      A5: 'Guests',
      B5: 'guests = {40 to 160 by 20}',
      A7: 'Venue fee',
      B7: 'fee = IF(venue = "Library", 2500, IF(venue = "Barn", 5000, 9000)) * IF(day = "Weekend", 1.5, 1)',
      A8: 'Catering per guest',
      B8: 'perGuest = IF(venue = "Yacht club", 140, 95)',
      A9: 'Catering',
      B9: '=guests * perGuest',
      A11: 'TOTAL',
      B11: 'total = fee + B9',
      A12: 'Under $20k?',
      B12: '=total <= 20000',
    },
  },
  {
    name: 'Project estimate',
    blurb: 'Durations are distributions, so there are infinitely many scenarios: Monte Carlo.',
    cells: {
      A1: 'Project estimate (days)',
      A3: 'Design',
      B3: 'design = normal(10, 2)',
      A4: 'Build',
      B4: 'build = normal(25, 6)',
      A5: 'Test',
      B5: 'test = uniform(5, 15)',
      A6: 'Needs rework?',
      B6: 'rework = {true, false x 3}',
      A7: 'Rework',
      B7: '=IF(rework, build * 0.4, 0)',
      A9: 'TOTAL',
      B9: 'total = design + build + test + B7',
      A10: 'Done in 8 weeks?',
      B10: '=total <= 40',
    },
  },
  {
    name: 'Savings',
    blurb: 'A balance over five years, for each rate and deposit: a range-valued cell, shown as a line chart.',
    cells: {
      A1: 'Savings',
      A2: 'Interest rate',
      B2: 'rate = {0.02, 0.05, 0.08}',
      A3: 'Yearly deposit',
      B3: 'deposit = {1000, 2000}',
      A5: 'Year',
      B5: 'Balance',
      A6: '0',
      B6: '5000',
      ...Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [
          ['A' + (i + 7), String(i + 1)],
          ['B' + (i + 7), `=B${i + 6} * (1 + rate) + deposit`],
        ]).flat(),
      ),
      A13: 'Over time',
      B13: 'growth = A6:B11',
    },
  },
  {
    name: 'Ten dice',
    blurb: '60 million scenarios: finite, but far too many to check, so they are sampled.',
    cells: {
      A1: 'Ten dice',
      B1: 'total = SUM(A3:A12)',
      C1: '=total >= 45',
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['A' + (i + 3), '{1 to 6}'])),
    },
  },
];
