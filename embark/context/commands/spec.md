# Commands

The substrate behind the `/` command menu: the command channels, the suggestion
shape, and the shared place/route resolution helpers.

- `commands:queries` / `commands:suggestions`: request/response channels between
  the editor extension and the provider cards that answer with suggestions
- the menu itself ships as the [commands card](../../cards/commands-card);
  provider cards like [Weather](automerge:2gtsy4b6hU38DQAMPk6kYHLwxrxE) and
  [Routes](automerge:41HBbYkbrqYd9STaojjQUsFc1jDW) fill in the suggestions
- place/route resolution helpers shared by the weather and route cards
- ships the commands context visualizer
