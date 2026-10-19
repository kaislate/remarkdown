<script lang="ts">
  import Plus from 'phosphor-svelte/lib/Plus';
  import Trash from 'phosphor-svelte/lib/Trash';
  import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
  import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
  import Swap from 'phosphor-svelte/lib/Swap';
  import TextIndent from 'phosphor-svelte/lib/TextIndent';
  import TextOutdent from 'phosphor-svelte/lib/TextOutdent';
  import BoundingBox from 'phosphor-svelte/lib/BoundingBox';
  import SelectionAll from 'phosphor-svelte/lib/SelectionAll';
  import Note from 'phosphor-svelte/lib/Note';
  import User from 'phosphor-svelte/lib/User';
  import Users from 'phosphor-svelte/lib/Users';
  import Chat from 'phosphor-svelte/lib/Chat';
  import Palette from 'phosphor-svelte/lib/Palette';
  import TextT from 'phosphor-svelte/lib/TextT';
  import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
  import Clock from 'phosphor-svelte/lib/Clock';
  import Flag from 'phosphor-svelte/lib/Flag';
  import Check from 'phosphor-svelte/lib/Check';
  import Star from 'phosphor-svelte/lib/Star';
  import Key from 'phosphor-svelte/lib/Key';
  import Table from 'phosphor-svelte/lib/Table';
  import ListBullets from 'phosphor-svelte/lib/ListBullets';
  import Hash from 'phosphor-svelte/lib/Hash';
  import Repeat from 'phosphor-svelte/lib/Repeat';
  import Stack from 'phosphor-svelte/lib/Stack';
  import Circle from 'phosphor-svelte/lib/Circle';
  import Square from 'phosphor-svelte/lib/Square';
  import Rectangle from 'phosphor-svelte/lib/Rectangle';
  import Diamond from 'phosphor-svelte/lib/Diamond';
  import Hexagon from 'phosphor-svelte/lib/Hexagon';
  import Cylinder from 'phosphor-svelte/lib/Cylinder';
  import Pill from 'phosphor-svelte/lib/Pill';
  import Parallelogram from 'phosphor-svelte/lib/Parallelogram';
  import Cloud from 'phosphor-svelte/lib/Cloud';
  import Lightning from 'phosphor-svelte/lib/Lightning';
  import Triangle from 'phosphor-svelte/lib/Triangle';
  import Octagon from 'phosphor-svelte/lib/Octagon';
  import Database from 'phosphor-svelte/lib/Database';
  import Cube from 'phosphor-svelte/lib/Cube';
  import Package from 'phosphor-svelte/lib/Package';
  import FunctionIcon from 'phosphor-svelte/lib/Function';
  import X from 'phosphor-svelte/lib/X';
  import GitBranch from 'phosphor-svelte/lib/GitBranch';
  import ChartPie from 'phosphor-svelte/lib/ChartPie';
  import ChartBar from 'phosphor-svelte/lib/ChartBar';
  import TreeStructure from 'phosphor-svelte/lib/TreeStructure';
  import Kanban from 'phosphor-svelte/lib/Kanban';
  import FlowArrow from 'phosphor-svelte/lib/FlowArrow';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import type { FormIcon } from '../lib/editor/mermaid/form';

  interface Props {
    name: FormIcon;
    size?: number;
  }
  let { name, size = 14 }: Props = $props();

  const ICONS = {
    plus: Plus, trash: Trash, up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight,
    link: LinkSimple, swap: Swap, indent: TextIndent, outdent: TextOutdent, group: BoundingBox,
    ungroup: SelectionAll, note: Note, user: User, users: Users, chat: Chat, palette: Palette,
    text: TextT, calendar: CalendarBlank, clock: Clock, flag: Flag, check: Check, star: Star,
    key: Key, table: Table, list: ListBullets, hash: Hash, repeat: Repeat, stack: Stack,
    circle: Circle, square: Square, rect: Rectangle, diamond: Diamond, hexagon: Hexagon,
    cylinder: Cylinder, pill: Pill, parallelogram: Parallelogram, cloud: Cloud, lightning: Lightning,
    triangle: Triangle, octagon: Octagon, database: Database, cube: Cube, package: Package,
    function: FunctionIcon, x: X, branch: GitBranch, pie: ChartPie, chart: ChartBar, tree: TreeStructure,
    kanban: Kanban, flow: FlowArrow, dots: DotsThree,
  } as const;

  const Icon = $derived(ICONS[name] ?? DotsThree);
</script>

<Icon {size} />
