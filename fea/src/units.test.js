import { DIMENSIONS, unitsOf, unitNamed, isQuantity, toSI, fromSI, convert, parseQuantity, num, format, pretty, prettyUnit } from "./units.js";

describe("toSI, fromSI and convert", () => {
  for (const [dimension, d] of Object.entries(DIMENSIONS)) {
    it(`${dimension}: every unit goes to SI and back`, () => {
      expect(d.units[d.si]).toBe(1);
      for (const unit of unitsOf(dimension)) {
        const q = { value: 3.7, unit };
        const si = toSI(q, dimension);
        expect(si).toBe(3.7 * d.units[unit]);
        expect(fromSI(si, unit, dimension).value).toBeCloseTo(3.7, 12);
        expect(fromSI(si, unit, dimension).unit).toBe(unit);
        // and through every other unit, the same quantity
        for (const other of unitsOf(dimension)) {
          const c = convert(q, other, dimension);
          expect(c.unit).toBe(other);
          expect(toSI(c, dimension) / si).toBeCloseTo(1, 10);
          expect(convert(c, unit, dimension).value).toBeCloseTo(3.7, 10);
        }
      }
    });
  }

  it("1 in is exactly 25.4 mm, and 1 ft exactly 304.8 mm", () => {
    expect(convert({ value: 1, unit: "in" }, "mm", "length")).toEqual({ value: 25.4, unit: "mm" });
    expect(convert({ value: 1, unit: "ft" }, "mm", "length")).toEqual({ value: 304.8, unit: "mm" });
    expect(convert({ value: 1, unit: "ksi" }, "psi", "pressure")).toEqual({ value: 1000, unit: "psi" });
  });

  it("converting to its own unit changes nothing", () => {
    expect(convert({ value: 0.1 + 0.2, unit: "mm" }, "mm", "length")).toEqual({ value: 0.1 + 0.2, unit: "mm" });
  });

  it("a quantity of another dimension, or not a quantity, is NaN in SI and null converted", () => {
    expect(toSI({ value: 2, unit: "kN" }, "length")).toBeNaN();
    expect(toSI({ value: Infinity, unit: "m" }, "length")).toBeNaN();
    expect(toSI(2, "length")).toBeNaN();
    expect(toSI(null, "length")).toBeNaN();
    expect(convert({ value: 2, unit: "kN" }, "mm", "length")).toBeNull();
    expect(isQuantity({ value: 2, unit: "kN" }, "force")).toBe(true);
    expect(isQuantity({ value: "2", unit: "kN" }, "force")).toBe(false);
  });

  it("fromSI refuses a unit of another dimension, and an unknown dimension throws", () => {
    expect(() => fromSI(1, "kN", "length")).toThrow();
    expect(() => toSI({ value: 1, unit: "m" }, "colour")).toThrow();
  });
});

describe("parseQuantity", () => {
  it("reads text with a space, without one, with an exponent, padded", () => {
    expect(parseQuantity("2 kN", "force")).toEqual({ value: 2, unit: "kN" });
    expect(parseQuantity("2.5e3N", "force")).toEqual({ value: 2500, unit: "N" });
    expect(parseQuantity(" 70 GPa ", "pressure")).toEqual({ value: 70, unit: "GPa" });
    expect(parseQuantity("-3.5 mm", "length")).toEqual({ value: -3.5, unit: "mm" });
    expect(parseQuantity(".5 m", "length")).toEqual({ value: 0.5, unit: "m" });
    expect(parseQuantity("+4E-2 m", "length")).toEqual({ value: 0.04, unit: "m" });
  });

  it("reads an object, its value a number or a numeral", () => {
    expect(parseQuantity({ value: 2, unit: "kN" }, "force")).toEqual({ value: 2, unit: "kN" });
    expect(parseQuantity({ value: "2.5", unit: "kN" }, "force")).toEqual({ value: 2.5, unit: "kN" });
    expect(parseQuantity({ value: 2, unit: "kn" }, "force")).toEqual({ value: 2, unit: "kN" });
  });

  it("reads the other ways people write a unit", () => {
    expect(parseQuantity("200 N/mm2", "pressure")).toEqual({ value: 200, unit: "MPa" });
    expect(parseQuantity("200 N/mm²", "pressure")).toEqual({ value: 200, unit: "MPa" });
    expect(parseQuantity("7850 kg/m3", "density")).toEqual({ value: 7850, unit: "kg/m³" });
    expect(parseQuantity("12 um", "length")).toEqual({ value: 12, unit: "µm" });
    expect(parseQuantity("12 μm", "length")).toEqual({ value: 12, unit: "µm" }); // Greek mu, not the micro sign
    expect(parseQuantity("3 inches", "length")).toEqual({ value: 3, unit: "in" });
    expect(parseQuantity('3"', "length")).toEqual({ value: 3, unit: "in" });
    expect(parseQuantity("2 cc", "volume")).toEqual({ value: 2, unit: "cm³" });
    expect(parseQuantity("9.81 m/s^2", "acceleration")).toEqual({ value: 9.81, unit: "m/s²" });
    expect(parseQuantity("2 G", "acceleration")).toEqual({ value: 2, unit: "g" });
  });

  it("'lb' is a force where a force is asked for and a mass where a mass is", () => {
    expect(parseQuantity("10 lb", "force")).toEqual({ value: 10, unit: "lbf" });
    expect(parseQuantity("10 lb", "mass")).toEqual({ value: 10, unit: "lb" });
  });

  it("forgives a slip of case where only one unit is meant", () => {
    expect(parseQuantity("70 gpa", "pressure")).toEqual({ value: 70, unit: "GPa" });
    expect(parseQuantity("2 KN", "force")).toEqual({ value: 2, unit: "kN" });
    expect(parseQuantity("5 MM", "length")).toEqual({ value: 5, unit: "mm" });
    expect(parseQuantity("5 HZ", "frequency")).toEqual({ value: 5, unit: "Hz" });
    expect(parseQuantity("5 KPA", "pressure")).toEqual({ value: 5, unit: "kPa" });
  });

  it("refuses a bare number, as text or not", () => {
    expect(parseQuantity("5", "force")).toBeNull();
    expect(parseQuantity("55", "force")).toBeNull();
    expect(parseQuantity("2.5", "force")).toBeNull();
    expect(parseQuantity("1e3", "force")).toBeNull();
    expect(parseQuantity(5, "force")).toBeNull();
    expect(parseQuantity({ value: 5 }, "force")).toBeNull();
    expect(parseQuantity("", "force")).toBeNull();
    expect(parseQuantity(null, "force")).toBeNull();
    expect(parseQuantity(undefined, "force")).toBeNull();
  });

  it("refuses an unknown unit and a unit of another dimension", () => {
    expect(parseQuantity("2 furlongs", "length")).toBeNull();
    expect(parseQuantity("2 kN", "length")).toBeNull();
    expect(parseQuantity("2 mm", "force")).toBeNull();
    expect(parseQuantity({ value: 2, unit: "MPa" }, "force")).toBeNull();
    expect(parseQuantity({ value: "two", unit: "N" }, "force")).toBeNull();
    expect(parseQuantity({ value: NaN, unit: "N" }, "force")).toBeNull();
    expect(parseQuantity("2 kN kN", "force")).toBeNull();
  });

  // an object's value that is empty text is no number (Number("") would be 0)
  it("refuses an object whose value is empty text", () => {
    expect(parseQuantity({ value: "", unit: "kN" }, "force")).toBeNull();
    expect(parseQuantity({ value: "  ", unit: "kN" }, "force")).toBeNull();
  });

  // "mN" and "mPa" are milli- units, written properly: never a slip of case for MN or MPa, a thousand million times larger
  it("doesn't read a milli- unit as a mega- one", () => {
    expect(parseQuantity("2 mN", "force")).not.toEqual({ value: 2, unit: "MN" });
    expect(parseQuantity("2 mPa", "pressure")).not.toEqual({ value: 2, unit: "MPa" });
  });
});

describe("unitNamed", () => {
  it("an exact unit first, then an alias, then a caseless match", () => {
    expect(unitNamed("mm", "length")).toBe("mm");
    expect(unitNamed("micron", "length")).toBe("µm");
    expect(unitNamed("L", "volume")).toBe("L");
    expect(unitNamed("l", "volume")).toBe("L");
    expect(unitNamed("Mm", "length")).toBe("mm");
    expect(unitNamed("", "length")).toBeNull();
    expect(unitNamed(null, "length")).toBeNull();
  });
});

describe("num", () => {
  it("three significant digits, written as a person writes them", () => {
    expect(num(0)).toBe("0");
    expect(num(1234.5)).toBe("1230");
    expect(num(123.45)).toBe("123");
    expect(num(12.345)).toBe("12.3");
    expect(num(1.2345)).toBe("1.23");
    expect(num(0.012345)).toBe("0.0123");
    expect(num(0.00012345)).toBe("0.000123");
    expect(num(1000)).toBe("1000");
    expect(num(2)).toBe("2");
  });

  it("an exponent past a million and under a ten-thousandth", () => {
    expect(num(1e-7)).toBe("1×10⁻⁷");
    expect(num(2.5e8)).toBe("2.5×10⁸");
    expect(num(12345678)).toBe("1.23×10⁷");
    expect(num(1e6)).toBe("1×10⁶");
    expect(num(5e-5)).toBe("5×10⁻⁵");
  });

  it("negatives with a minus sign", () => {
    expect(num(-1234.5)).toBe("−1230");
    expect(num(-0.012345)).toBe("−0.0123");
  });

  it("what isn't a number is a dash", () => {
    expect(num(NaN)).toBe("–");
    expect(num(Infinity)).toBe("–");
  });

  it("other numbers of digits", () => {
    expect(num(1234.5, 2)).toBe("1200");
    expect(num(1234.5, 4)).toBe("1235");
    expect(num(Math.PI, 5)).toBe("3.1416");
  });

  // one minus sign (U+2212) however the number is written
  it("writes the same minus sign with an exponent as without", () => {
    expect(num(-2.5e8)).toBe("−2.5×10⁸");
    expect(num(-1e-7)).toBe("−1×10⁻⁷");
  });

  // it is rounded first and written second: 999,999.6 is written as 1,000,000 is
  it("writes a number that rounds to a boundary the way it writes the boundary", () => {
    expect(num(999999.6)).toBe(num(1e6));
    expect(num(0.000099996)).toBe(num(0.0001));
  });
});

describe("format", () => {
  it("a quantity at four digits, with its unit", () => {
    expect(format({ value: 2, unit: "kN" })).toBe("2 kN");
    expect(format({ value: 1234.56, unit: "N" })).toBe("1235 N");
    expect(format(null)).toBe("–");
    expect(format({ value: NaN, unit: "N" })).toBe("–");
  });
});

describe("pretty and prettyUnit", () => {
  it("the largest unit of the ladder in which the number is at least one", () => {
    expect(pretty(0.00012, "length")).toBe("120 µm");
    expect(pretty(0.012, "length")).toBe("12 mm");
    expect(pretty(1.5, "length")).toBe("1.5 m");
    expect(pretty(1500, "length")).toBe("1500 m");
    expect(pretty(2.5e8, "pressure")).toBe("250 MPa");
    expect(pretty(2e11, "pressure")).toBe("200 GPa");
    expect(pretty(12, "pressure")).toBe("12 Pa");
    expect(pretty(3e4, "pressure")).toBe("30 kPa");
    expect(pretty(-2.5e8, "pressure")).toBe("−250 MPa");
  });

  it("below the ladder's bottom, the bottom unit", () => {
    expect(pretty(1e-9, "length")).toBe("0.001 µm");
    expect(pretty(0.5, "pressure")).toBe("0.5 Pa");
    expect(pretty(0, "length")).toBe("0 µm");
  });

  it("just under a step it stays; just over, where three digits would round to 1000, it climbs", () => {
    expect(pretty(999.4e-6, "length")).toBe("999 µm");
    expect(pretty(999.6e-6, "length")).toBe("1 mm");
    expect(pretty(999.4e-3, "length")).toBe("999 mm");
    expect(pretty(999.6e-3, "length")).toBe("1 m");
    expect(pretty(999.4, "pressure")).toBe("999 Pa");
    expect(pretty(999.6, "pressure")).toBe("1 kPa");
    expect(pretty(999.4e3, "pressure")).toBe("999 kPa");
    expect(pretty(999.6e3, "pressure")).toBe("1 MPa");
    expect(pretty(999.4e6, "pressure")).toBe("999 MPa");
    expect(pretty(999.6e6, "pressure")).toBe("1 GPa");
  });

  it("a unit can be forced; what isn't a number is a dash", () => {
    expect(pretty(0.5, "length", { unit: "mm" })).toBe("500 mm");
    expect(pretty(NaN, "length")).toBe("–");
  });

  it("prettyUnit is the unit pretty picks", () => {
    for (const [x, dimension] of [[0.00012, "length"], [999.6e-6, "length"], [2.5e8, "pressure"], [999.4e3, "pressure"], [1e-9, "length"], [-3e4, "pressure"], [2.5, "mass"], [0.5, "mass"]]) {
      expect(pretty(x, dimension).endsWith(` ${prettyUnit(x, dimension)}`)).toBe(true);
    }
    expect(prettyUnit(NaN, "length")).toBe("µm");
  });
});
