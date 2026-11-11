/**
 * TJ Hide and Seek - the school, shared by the browser and the Node server.
 *
 * Traced from the two TJHSST floor plans (tj_hide_side/first_floor.heic, second_floor.heic). Every room is
 * written in the pixel coordinates of its own plan photo (2000 x 1500 downscale); the floor 2 photo was
 * registered onto floor 1 with a least-squares affine fit through the stairwells and the Dome, so both floors
 * share one coordinate system. One plan pixel is SCALE metres.
 *
 * Axes: x east, y up, z south (plan up = north = -z). Floor 1 is at y = 0, floor 2 at y = F2Y.
 *
 *   build() -> {
 *     rooms[]        {name, kind, floor, poly[[x,z]], doors[{x,z,nx,nz,w}], edges[] (classified)}
 *     courts[]       outdoor courtyards on floor 1 (polygons)
 *     outline[1|2]   building outline per floor (polygon, with open edges)
 *     voids[]        holes in the floor-2 slab (Nobel atrium) - railed
 *     stairs[]       switch-back or straight stairs between the floors
 *     fills[]        sealed slivers: gaps under SLIVER metres between rooms / stairs / outer walls (solid, not walkable)
 *     walls[]        collision segments {a:[x,z], b:[x,z], y0, y1}
 *     labels[]       neighbourhood names (Nobel, Einstein, Tesla ...) for signs and locate()
 *     ground(x, z, y) the floor height under a point (stairs included), locate(x, y, z) -> place name
 *     validSpot(x, y, z) is a hiding spot inside the school (the server checks every hide)
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TJMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCALE = 0.14;                 // metres per plan pixel
  const OX = 1000, OY = 800;          // plan pixel at the world origin
  const F2Y = 4.5;                    // floor 2 level
  const CEIL = 4.2;                   // ceiling height on both floors (slab 4.2..4.5)
  const ROOF = 8.9;                   // top of the floor 2 walls (ceiling at F2Y + CEIL = 8.7)
  const DOME = { x: 918, y: 308, r: 32, cols: 47 };   // the rotunda (glass drum r, column ring r) in plan px
  const SLIVER = 1.25;                // gaps narrower than this between walls are solid in the real building
  const STAIR_DOOR = 1.4;             // stairwell doors (both floors)

  // floor 2 photo -> floor 1 photo (affine, fitted on 9 stairwells + the Dome; residual 2-4 m)
  const T2 = (x, y) => [0.88061 * x + 0.0511 * y + 244.4, -0.00894 * x + 0.90389 * y + 82.2];
  const W = ([x, y]) => [+((x - OX) * SCALE).toFixed(3), +((y - OY) * SCALE).toFixed(3)];

  // ---------------------------------------------------------------- floor 1 (plan px)
  // outline, clockwise on the plan. A point written [x, y, 'o'] makes the edge to the next point open (no wall).
  const F1_OUTLINE = [
    [175, 195], [390, 200], [520, 203], [595, 212], [638, 272], [715, 210], [737, 212], [868, 343], [897, 340, 'o'],
    [940, 340], [948, 345], [975, 418], [1125, 410], [1125, 167], [1181, 148], [1234, 122], [1250, 135], [1397, 145],
    [1400, 150], [1665, 155], [1684, 186], [1750, 186], [1750, 228], [1867, 232], [1867, 645], [1722, 650], [1730, 725],
    [1870, 730], [1870, 850], [1922, 850], [1922, 950], [1888, 950], [1888, 1030], [1740, 1036], [1740, 1215],
    [1600, 1219], [1545, 1225], [1475, 1225], [1475, 1355], [1157, 1355], [1157, 1350], [1060, 1350], [1043, 1320],
    [1043, 1205], [1080, 1205], [1080, 1150], [795, 1150], [795, 1372], [686, 1381], [335, 1378], [335, 1045],
    [205, 1045], [205, 578], [175, 578],
  ];
  // exterior doors (numbered like the plan); the outline wall gets a gap at the closest point
  const F1_DOORS = [
    ['Door 2', 1125, 335], ['Door 3', 1676, 172], ['Door 4', 1867, 482], ['Door 5', 1740, 1180], ['Door 6', 1515, 1225],
    ['Door 7', 1325, 1355], ['Door 8', 1040, 1150], ['Door 9', 700, 1380], ['Door 10', 335, 1090], ['Door 11', 205, 838],
    ['Door 12', 205, 600], ['Door 13', 175, 272], ['Door 14', 530, 204], ['Door 15', 760, 234], ['Door D', 1922, 905],
  ];
  // outdoor courtyards (inside the outline, no roof)
  const COURTS = [
    { name: 'Courtyard', poly: [[852, 578], [1000, 575], [1000, 680], [958, 690], [975, 755], [1000, 756], [1000, 835],
      [965, 850], [985, 925], [1000, 930], [1000, 983], [795, 983], [795, 885], [828, 880], [828, 752], [800, 705], [818, 650]],
      // [828, 856]: from the Gandhi hallway; part: only the hallway stretch of that edge is glass (107 HPE has its own wall)
      doors: [[1000, 620], [1000, 956], [926, 577], [882, 983], [809, 678], [828, 856, { part: true }]] },
    { name: 'East Courtyard', poly: [[1193, 562], [1372, 562], [1372, 972], [1205, 972], [1205, 884], [1274, 884],
      [1274, 834], [1205, 834], [1205, 758], [1222, 753], [1250, 680], [1197, 665]],
      doors: [[1195, 610], [1205, 950], [1372, 900], [1226, 562]] },
  ];

  // [name, kind, x0, y0, x1, y1] or [name, kind, [[x, y], ...]]; optional last element {door: 'none' | sides like 's' or 'ws'}
// (with sides given, the room gets exactly one door on each of those sides, whatever is behind them)
  const F1_ROOMS = [
    // music & arts wing (west)
    ['135', 'music', 210, 197, 357, 265], ['134 Band', 'music', 210, 297, 332, 397], ['Practice Rooms', 'music', 215, 397, 332, 470],
    ['131 Orchestra', 'music', 210, 485, 332, 572], ['Music Office', 'office', 178, 200, 210, 265],
    ['Practice 1', 'music', 178, 300, 210, 400], ['Practice 2', 'music', 178, 400, 210, 480], ['Practice 3', 'music', 178, 480, 210, 572],
    ['Auditorium', 'aud', 360, 202, 532, 522], ['Scene Shop', 'store', 535, 210, 595, 295], ['123', 'office', 535, 300, 595, 390],
    ['Storage', 'store', 535, 405, 600, 500],
    // admin
    ['Admin Wing', 'office', [[660, 300], [715, 214], [737, 216], [842, 320], [800, 368], [660, 368]]],
    ['Front Office', 'office', [[800, 368], [842, 320], [866, 344], [890, 372], [890, 425], [815, 425], [815, 380]]],
    ['Kitchen', 'office', 707, 380, 745, 428], ['Work Room', 'office', 745, 380, 790, 428], ['Admin Offices', 'office', 600, 300, 657, 398],
    ['PCR', 'class', 660, 432, 725, 490], ['118', 'class', 725, 432, 790, 490], ['Archive', 'store', 815, 432, 850, 490],
    // north row along the main corridor
    ['115 PF', 'class', 997, 420, 1052, 482], ['115B', 'office', 1052, 418, 1100, 482], ['115C', 'office', 1100, 414, 1144, 474],
    ['Offices', 'office', 1144, 414, 1216, 474], ['12', 'class', 1216, 404, 1288, 470], ['11 Workroom', 'office', 1288, 404, 1394, 470],
    ['10', 'class', 1462, 400, 1525, 466], ['4 Ocean', 'lab', 1525, 344, 1622, 466], ['2 Ocean', 'lab', 1622, 344, 1685, 466],
    // DaVinci research labs (north-east)
    ['9 Energy', 'lab', [[1127, 168], [1181, 150], [1234, 125], [1250, 137], [1250, 262], [1127, 262]]],
    ['8 Proto', 'lab', 1250, 138, 1397, 262], ['9', 'lab', 1147, 264, 1234, 326], ['Prep Room', 'store', 1234, 264, 1338, 326],
    ['8', 'lab', 1338, 258, 1400, 324], ['6 JUMP', 'lab', 1403, 152, 1472, 320], ['5 Neuro', 'lab', 1472, 156, 1566, 320],
    ['3 Chem', 'lab', 1566, 160, 1662, 322], ['7 Optics', 'lab', 1128, 344, 1290, 404], ['Lab Office', 'office', 1290, 360, 1362, 404],
    // back-of-house kitchen north of the cafeteria: storage, walk-in coolers, the kitchen, its offices and the servery
    ['Kitchen Storage', 'store', 1700, 228, 1752, 288], ['Kitchen Office', 'office', 1752, 234, 1865, 290, { door: 's' }],
    ['Walk-in Coolers', 'store', 1700, 288, 1755, 386], ['Cafeteria Kitchen', 'kitchen', 1755, 290, 1865, 386, { door: 's' }],
    ['Servery', 'kitchen', 1700, 386, 1865, 466, { door: 'ws' }],
    // CS labs, cafeteria, Turing
    ['68 CS Lab', 'cs', 1024, 506, 1153, 568],
    ['69', 'class', 1032, 575, 1095, 636], ['66', 'class', 1095, 575, 1160, 636], ['70', 'class', 1032, 636, 1095, 698],
    ['65', 'class', 1095, 636, 1160, 698], ['71', 'class', 1032, 700, 1095, 765], ['64', 'class', 1095, 700, 1160, 765],
    ['73', 'class', 1032, 765, 1095, 833], ['62', 'class', 1095, 765, 1160, 833], ['74', 'class', 1035, 850, 1095, 918],
    ['61', 'class', 1095, 850, 1162, 918], ['75', 'class', 1035, 918, 1095, 986], ['60', 'class', 1095, 918, 1162, 986], ['13', 'office', 1260, 505, 1275, 560], ['14', 'class', 1275, 497, 1362, 560],
    ['15 CS Lab', 'cs', 1365, 497, 1473, 560], ['16 CS Lab', 'cs', 1500, 497, 1600, 557], ['17 CS Lab', 'cs', 1600, 497, 1707, 557],
    ['18 CS Lab', 'cs', 1375, 562, 1473, 635], ['22', 'class', 1375, 637, 1473, 733], ['23', 'class', 1375, 735, 1473, 850],
    ['Cafeteria', 'cafe', 1716, 466, 1865, 645], ['Serving Line', 'kitchen', 1500, 560, 1590, 640], ['Fan Room', 'mech', 1590, 560, 1714, 718],
    ['Boiler Room', 'mech', 1503, 642, 1597, 787], ['Bldg Eng', 'office', 1505, 790, 1560, 850], ['25', 'office', 1560, 790, 1597, 850],
    ['26', 'class', 1597, 733, 1677, 847], ['27', 'class', 1677, 733, 1737, 847], ['28', 'class', 1737, 733, 1797, 847],
    ['29', 'class', 1797, 733, 1842, 847], ['30', 'office', 1842, 770, 1868, 847],
    ['37', 'class', 1517, 885, 1600, 950], ['36', 'class', 1600, 885, 1673, 950], ['Turing Office', 'office', 1673, 885, 1720, 945],
    ['Workroom', 'office', 1720, 887, 1810, 927], ['31', 'class', 1813, 887, 1870, 930],
    ['39', 'class', 1517, 950, 1600, 1004], ['40', 'office', 1520, 1006, 1578, 1045],
    ['34 D&T', 'lab', 1607, 950, 1733, 1032], ['33 D&T', 'lab', 1773, 950, 1886, 1028],
    ['38', 'office', 1440, 903, 1493, 967], ['49 Office', 'office', 1385, 905, 1440, 973], ['49', 'class', 1345, 977, 1425, 1050],
    ['Restrooms', 'rest', 1428, 980, 1495, 1050], ['58', 'class', 1205, 977, 1272, 1050], ['56', 'class', 1272, 977, 1342, 1050],
    // Einstein (south-east)
    ['50', 'class', 1347, 1069, 1422, 1145], ['48', 'class', 1422, 1069, 1497, 1145], ['44', 'office', 1520, 1069, 1557, 1114],
    ['D&T Office', 'office', 1557, 1069, 1610, 1114], ['45', 'lab', 1526, 1116, 1610, 1219], ['42 D&T', 'lab', 1612, 1038, 1690, 1217],
    ['46', 'office', 1475, 1148, 1503, 1223],
    ['51', 'lab', 1360, 1150, 1472, 1237], ['52', 'lab', 1360, 1257, 1472, 1353], ['54', 'lab', 1159, 1150, 1252, 1239],
    ['53', 'lab', 1159, 1265, 1257, 1353], ['59', 'class', 1175, 1074, 1250, 1146], ['57', 'class', 1250, 1074, 1345, 1146],
    ['77', 'office', 1136, 1078, 1175, 1146],
    ['Planetarium', 'plan', [[1045, 1207], [1155, 1207], [1155, 1348], [1062, 1348], [1045, 1318]]],
    // south rows (80s), Faraday, Gandhi
    ['80', 'class', 1040, 1080, 1078, 1148], ['82', 'class', 971, 1081, 1039, 1148], ['84', 'class', 900, 1081, 971, 1148],
    ['85', 'class', 829, 1081, 900, 1148], ['87', 'class', 760, 1081, 829, 1148],
    ['86', 'class', 775, 992, 846, 1052], ['83', 'class', 921, 992, 998, 1052], ['Restrooms', 'rest', 998, 992, 1022, 1052],
    ['81', 'class', 1039, 990, 1107, 1052], ['Storage', 'store', 1111, 990, 1170, 1052],
    ['105 Finance', 'class', 715, 932, 792, 990], ['106 8th/Tecuci', 'office', 718, 892, 792, 930], ['Restrooms', 'rest', 715, 992, 773, 1052],
    ['107 HPE', 'class', 750, 750, 824, 832], ['Gandhi Offices', 'office', 712, 705, 750, 832], ['111 Art', 'art', 712, 580, 792, 700],
    ['Art Gallery', 'art', 709, 540, 845, 577], ['Court Storage', 'store', [[1000, 680], [960, 690], [975, 755], [1000, 756]]],
    ['East Office', 'office', [[1197, 665], [1250, 680], [1222, 753], [1203, 757]]],
    // athletics (west)
    ['113 PTSA', 'office', 601, 582, 683, 633], ['110 Activities', 'office', 601, 633, 683, 700], ['109 Clinic', 'office', 601, 700, 683, 786],
    ['103 Storage', 'store', 601, 786, 639, 833], ['104', 'office', 639, 786, 683, 833], ['Gym Office', 'office', 562, 593, 601, 838],
    ['Gym 1', 'gym', 304, 593, 562, 838], ['129', 'office', 245, 600, 300, 652], ['130', 'office', 210, 600, 245, 652],
    ['Training Room', 'office', 210, 655, 300, 713], ['98 ATC', 'office', 210, 715, 266, 800], ['ATC Office', 'office', 266, 715, 300, 800],
    ['Boys Locker Room', 'locker', 210, 858, 360, 1043], ['Wrestling Room', 'gym', 378, 855, 481, 968],
    ['Weight Room', 'gym', 375, 970, 530, 1040], ['Girls Locker Room', 'locker', 533, 858, 683, 1043],
    ['Gym Storage', 'store', 362, 1063, 498, 1102], ['Gym 2', 'gym', 502, 1063, 684, 1376], ['Team Rooms', 'locker', 339, 1128, 498, 1322],
    ['88 HPE', 'class', 717, 1200, 793, 1285], ['89 HPE', 'class', 717, 1285, 793, 1370],
  ];

  // ---------------------------------------------------------------- floor 2 (its own plan px; T2 maps to floor 1)
  const F2_OUTLINE = [
    [331, 250], [434, 250], [450, 254], [550, 157], [716, 326], [725, 346], [781, 346], [790, 376], [975, 376], [975, 110],
    [1100, 62], [1140, 92], [1145, 84], [1268, 84], [1270, 100], [1572, 100], [1572, 124], [1704, 124], [1704, 236],
    [1616, 236], [1616, 368], [1362, 368], [1362, 540], [1034, 540], [1034, 655], [1095, 672], [1068, 762], [1034, 772],
    [1034, 840], [1120, 840], [1120, 904], [1034, 904], [1034, 995], [1340, 995],
    [1340, 856], [1469, 856], [1469, 734], [1806, 734], [1806, 822], [1850, 822], [1858, 822], [1858, 984],
    [1819, 984], [1819, 1062], [1569, 1062], [1569, 1112], [1636, 1112], [1636, 1202], [1572, 1202], [1572, 1256],
    [1331, 1256], [1318, 1256], [1318, 1416], [972, 1416], [972, 1172], [520, 1172], [520, 1198], [468, 1198], [468, 1064],
    [499, 1064], [499, 995], [825, 995], [825, 926], [790, 909], [773, 843], [825, 826], [821, 787], [795, 735],
    [777, 665], [825, 643], [825, 539], [800, 557], [740, 556], [690, 548], [672, 540], [386, 540], [386, 330], [331, 330],
  ];
  const F2_VOIDS = [{ name: 'Nobel Atrium', poly: [[672, 379], [828, 379], [828, 442], [672, 442]] }];
  const F2_ROOMS = [
    ['Black Box', 'blackbox', 333, 252, 434, 328], ['227', 'office', 396, 332, 434, 364],
    ['Student Services', 'office', [[452, 256], [550, 160], [712, 324], [690, 352], [675, 372], [459, 372], [452, 330]]],
    ['219', 'class', 828, 379, 903, 440], ['217', 'class', 903, 379, 975, 440],
    ['Restrooms', 'rest', 400, 473, 444, 538], ['226 SS', 'class', 444, 473, 516, 538], ['Storage', 'store', 516, 473, 537, 538],
    ['225 CCC', 'class', 537, 473, 600, 538], ['224', 'class', 609, 473, 669, 538],
    ['Restrooms', 'rest', 868, 473, 919, 500], ['216/218', 'class', 919, 480, 997, 536],
    // Curie research wing
    ['207 Robotics', 'lab', [[977, 112], [1100, 64], [1139, 93], [1139, 250], [977, 250]]],
    ['206 AppDev', 'cs', 1156, 86, 1268, 208], ['203 DNA', 'lab', 1304, 108, 1388, 256], ['Prep Room', 'store', 1388, 108, 1420, 256],
    ['201 Biotech', 'lab', 1420, 104, 1572, 216], ['208 Electronics', 'lab', 977, 284, 1164, 374], ['Workroom', 'office', 1168, 272, 1220, 352],
    ['AP Office', 'office', 1252, 276, 1300, 362], ['202 CS', 'cs', 1348, 264, 1444, 364], ['200c', 'cs', 1444, 236, 1532, 364],
    ['200 CS', 'cs', 1532, 236, 1616, 364],
    ['215', 'class', 988, 380, 1068, 436], ['214', 'class', 1068, 380, 1144, 436], ['Restrooms', 'rest', 1144, 378, 1216, 436],
    ['Office', 'office', 1216, 380, 1276, 436], ['Newton', 'lounge', 1036, 484, 1120, 538], ['212', 'class', 1124, 472, 1224, 538],
    ['211', 'class', 1228, 472, 1332, 538],
    // library, internet cafe
    ['Library', 'library', [[825, 539], [995, 539], [995, 924], [825, 924], [790, 909], [773, 843], [825, 826], [821, 787],
      [795, 735], [777, 665], [825, 643]]],
    ['256D', 'office', 827, 541, 895, 620], ['Library Office', 'office', 827, 926, 895, 991], ['Library Conf Rm', 'office', 895, 926, 930, 991],
    ['Media Storage', 'store', 930, 926, 995, 991],
    ['Internet Cafe', 'lounge', [[1034, 660], [1092, 676], [1066, 760], [1034, 768]]],
    // south (Carver, Carson, Tesla)
    ['Restrooms', 'rest', 520, 995, 557, 1064], ['286', 'class', 557, 995, 642, 1064], ['Carver', 'lounge', 642, 995, 730, 1064],
    ['283', 'class', 730, 995, 807, 1064], ['281 IT Office', 'office', 807, 995, 857, 1064], ['278 Math Workroom', 'office', 857, 995, 961, 1064],
    ['AP', 'office', 961, 1022, 995, 1064],
    ['287', 'class', 524, 1098, 615, 1172], ['285', 'class', 615, 1098, 703, 1172], ['284', 'class', 703, 1098, 780, 1172],
    ['282', 'class', 780, 1098, 853, 1172], ['Carson', 'lounge', 853, 1098, 957, 1168],
    ['254', 'class', 1036, 995, 1103, 1064], ['252', 'class', 1103, 995, 1184, 1064], ['246 Humanities Wk', 'office', 1184, 995, 1295, 1064],
    ['Restrooms', 'rest', 1295, 995, 1338, 1064],
    ['255', 'class', 999, 1098, 1095, 1168], ['253', 'class', 1095, 1098, 1153, 1168], ['247', 'class', 1184, 1098, 1257, 1168],
    ['245', 'class', 1257, 1098, 1316, 1168],
    ['251', 'class', 980, 1176, 1084, 1272], ['250', 'class', 980, 1292, 1084, 1404], ['248', 'class', 1203, 1176, 1311, 1272],
    ['249', 'class', 1203, 1292, 1311, 1404],
    // Hopper (east)
    ['230', 'class', 1469, 736, 1562, 781], ['229', 'class', 1469, 781, 1562, 854], ['231 Workroom', 'office', 1600, 736, 1709, 781],
    ['232', 'class', 1709, 736, 1804, 781], ['233', 'class', 1709, 781, 1804, 854], ['234', 'office', 1806, 824, 1848, 854],
    ['239', 'class', 1375, 882, 1472, 950], ['240', 'class', 1375, 950, 1472, 1024], ['238', 'class', 1472, 903, 1556, 1062],
    ['237', 'class', 1556, 903, 1641, 1062], ['236', 'class', 1641, 903, 1725, 1062], ['235', 'class', 1725, 903, 1796, 1062],
    ['241 Lecture Hall', 'lecture', 1378, 1064, 1569, 1166], ['244', 'class', 1333, 1194, 1412, 1254], ['243', 'class', 1412, 1194, 1491, 1254],
    ['242', 'class', 1491, 1194, 1570, 1254],
  ];

  // stairs in floor-1 px. 'switch': two flights side by side, both ends at the entry face; `up` = the lane
  // (seen walking in) holding the lower flight. 'straight': one flight, bottom at the entry face, top at the far end.
  const STAIRS = [
    { name: 'West Stairs', type: 'switch', x0: 616, y0: 418, x1: 655, y1: 479, face: 's', up: 'R' },
    { name: 'Grand Staircase', type: 'straight', x0: 922, y0: 506, x1: 1000, y1: 536, face: 'e' },
    { name: 'DaVinci Stairs', type: 'switch', x0: 1420, y0: 404, x1: 1460, y1: 466, face: 's', up: 'L' },
    { name: 'Door 3 Stairs', type: 'switch', x0: 1691, y0: 190, x1: 1748, y1: 226, face: 'w', up: 'L' },
    { name: 'Courtyard Stairs', type: 'switch', x0: 1209, y0: 838, x1: 1270, y1: 880, face: 'w', up: 'L' },
    { name: 'D&T Stairs', type: 'switch', x0: 1694, y0: 1080, x1: 1734, y1: 1142, face: 's', up: 'L' },
    { name: 'Tesla Stairs', type: 'switch', x0: 1285, y0: 1280, x1: 1325, y1: 1342, face: 'n', up: 'L' },
    { name: 'Turing Stairs', type: 'switch', x0: 1876, y0: 882, x1: 1914, y1: 944, face: 'n', up: 'R' },
    { name: 'Carver Stairs', type: 'switch', x0: 719, y0: 1084, x1: 758, y1: 1146, face: 'n', up: 'L' },
  ];

  // neighbourhood (hallway) names, used on hanging signs and by locate()
  const LABELS = [
    [1, 'Nobel Commons', 925, 455], [1, 'Gandhi', 750, 865], [1, 'Faraday', 882, 1020], [1, 'Darwin', 1108, 1110],
    [1, 'Einstein', 1310, 1250], [1, 'Turing', 1700, 866], [1, 'DaVinci', 1470, 335], [1, 'Galileo', 1225, 530],
    [1, 'Cafe Commons', 1440, 872], [1, 'Aud Lobby', 455, 557], [1, 'Main Hallway', 1250, 486], [1, 'Gym Hallway', 580, 846],
    [1, 'Front Entrance', 918, 380],
    [2, 'Franklin', 525, 455], [2, 'Curie', 1210, 262], [2, 'Tesla', 1145, 1290], [2, 'Hopper', 1590, 820],
    [2, 'Carver Hall', 700, 1082], [2, 'Newton Hall', 1150, 455], [2, 'Library Hall', 1015, 760], [2, 'Lecture Hall Hallway', 1460, 1180],
  ];

  // ---------------------------------------------------------------- geometry helpers
  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  const rectPoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  function bbox(poly) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, z] of poly) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
    return { x0: a, z0: b, x1: c, z1: d };
  }
  function area(poly) { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]); return s / 2; }
  /** Clockwise on the plan (x east, z south) = positive area here; make every polygon wind the same way. */
  function wind(poly) { return area(poly) < 0 ? poly.slice().reverse() : poly; }
  function centroid(poly) {
    let x = 0, z = 0, a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      x += (poly[j][0] + poly[i][0]) * f; z += (poly[j][1] + poly[i][1]) * f; a += f;
    }
    return Math.abs(a) < 1e-9 ? poly[0] : [x / (3 * a), z / (3 * a)];
  }
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  }

  function room(def, floor) {
    const opts = typeof def[def.length - 1] === 'object' && !Array.isArray(def[def.length - 1]) ? def[def.length - 1] : {};
    const toF1 = floor === 2 ? p => T2(p[0], p[1]) : p => p;
    let poly;
    if (Array.isArray(def[2])) poly = def[2].map(p => W(toF1(p)));
    else if (floor === 2) {                       // keep floor-2 rectangles axis-aligned: map the centre lines
      const [x0, y0, x1, y1] = def.slice(2, 6), xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
      const a = W([T2(x0, yc)[0], T2(xc, y0)[1]]), b = W([T2(x1, yc)[0], T2(xc, y1)[1]]);
      poly = rectPoly(a[0], a[1], b[0], b[1]);
    } else poly = rectPoly(...W([def[2], def[3]]), ...W([def[4], def[5]]));
    // drop repeated points (the library outline doubles back over its zig-zag)
    poly = wind(poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05; }));
    // the two gyms are double height (open up to the floor-2 roof)
    return { name: def[0], kind: def[1], floor, poly, opts, doors: [], edges: [], tall: def[1] === 'gym' && /^Gym \d/.test(def[0]) };
  }

  // ---------------------------------------------------------------- build
  function build() {
    const out1 = [], open1 = [];
    F1_OUTLINE.forEach(p => { out1.push(W(p)); open1.push(p[2] === 'o'); });
    const out2 = F2_OUTLINE.map(p => W(T2(p[0], p[1])));
    const outline = { 1: { poly: out1, open: open1 }, 2: { poly: out2, open: out2.map(() => false) } };
    // a door may carry options as a third element ({part: true}); they ride along on the converted point
    const courts = COURTS.map(c => ({ name: c.name, poly: wind(c.poly.map(W)), doors: c.doors.map(d => Object.assign(W(d), d[2] ? { opts: d[2] } : {})) }));
    const voids = F2_VOIDS.map(v => ({ name: v.name, poly: wind(v.poly.map(p => W(T2(p[0], p[1])))) }));
    const rooms = [...F1_ROOMS.map(d => room(d, 1)), ...F2_ROOMS.map(d => room(d, 2))];
    const dome = { x: W([DOME.x, DOME.y])[0], z: W([DOME.x, DOME.y])[1], r: DOME.r * SCALE, cols: DOME.cols * SCALE };

    const stairs = STAIRS.map(s => {
      const [ax, az] = W([s.x0, s.y0]), [bx, bz] = W([s.x1, s.y1]);
      // local frame: u along the stair (0 at the entry face, l at the far end), v across (0..w, left to right walking in)
      const f = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] }[s.face];      // walking-in direction
      const r = [-f[1], f[0]];                                                  // right-hand side when walking in
      const l = s.face === 'n' || s.face === 's' ? bz - az : bx - ax, w = s.face === 'n' || s.face === 's' ? bx - ax : bz - az;
      const entry = { n: [ax, az], s: [bx, bz], e: [bx, bz], w: [ax, az] }[s.face];
      // origin = the left corner of the entry face
      const o = [entry[0] - r[0] * (s.face === 's' || s.face === 'w' ? w : 0) * 1, entry[1] - r[1] * (s.face === 's' || s.face === 'w' ? w : 0)];
      const st = { name: s.name, type: s.type, up: s.up || 'L', box: rectPoly(ax, az, bx, bz), f, r, l, w, landing: Math.min(1.6, l * 0.22) };
      // choose the origin so that origin + r*v + f*u covers the box for v in [0,w], u in [0,l]
      const cands = [[ax, az], [bx, az], [bx, bz], [ax, bz]];
      st.o = cands.find(c => { const px = c[0] + r[0] * w + f[0] * l, pz = c[1] + r[1] * w + f[1] * l;
        return Math.abs(px - (ax + bx - c[0])) < 0.01 && Math.abs(pz - (az + bz - c[1])) < 0.01; }) || o;
      return st;
    });
    const toLocal = (st, x, z) => { const dx = x - st.o[0], dz = z - st.o[1]; return [dx * st.f[0] + dz * st.f[1], dx * st.r[0] + dz * st.r[1]]; };
    const toWorld = (st, u, v) => [st.o[0] + st.f[0] * u + st.r[0] * v, st.o[1] + st.f[1] * u + st.r[1] * v];
    /** Height of the stair surface at local (u, v), or null outside the walkable part. */
    function stairHeight(st, u, v) {
      if (u < 0 || u > st.l || v < 0 || v > st.w) return null;
      if (st.type === 'straight') return F2Y * Math.max(0, Math.min(1, u / st.l));
      const run = st.l - st.landing, half = st.w / 2;
      if (u >= run) return F2Y / 2;                                             // landing at the far end
      const lower = (st.up === 'L') === (v < half);
      return lower ? (F2Y / 2) * (u / run) : F2Y / 2 + (F2Y / 2) * (1 - u / run);
    }

    const inStairBox = (x, z) => stairs.find(st => { const [u, v] = toLocal(st, x, z); return u >= 0 && u <= st.l && v >= 0 && v <= st.w; });
    const fills = [];
    const inFill = (f, x, z) => fills.some(fl => fl.floor === f && pointInPoly(x, z, fl.poly));
    const inCourt = (x, z) => courts.find(c => pointInPoly(x, z, c.poly));
    const inDome = (x, z) => Math.hypot(x - dome.x, z - dome.z) < dome.r;
    const insideFloor = (f, x, z) => f === 1 ? (pointInPoly(x, z, out1) || inDome(x, z)) : pointInPoly(x, z, out2) && !voids.some(v => pointInPoly(x, z, v.poly));
    const roomAt = (f, x, z) => rooms.find(r => r.floor === f && pointInPoly(x, z, r.poly));
    /** What is at (x, z) on floor f: 'out' | 'court' | 'void' | 'stair' | 'room' | 'hall'. */
    function cell(f, x, z) {
      if (f === 1 && inDome(x, z)) return 'hall';
      if (f === 1 && !pointInPoly(x, z, out1)) return 'out';
      if (f === 2 && !pointInPoly(x, z, out2)) return 'out';
      if (f === 2 && voids.some(v => pointInPoly(x, z, v.poly))) return 'void';
      if (f === 1 && inCourt(x, z)) return 'court';
      if (inStairBox(x, z)) return 'stair';
      if (roomAt(f, x, z)) return 'room';
      if (inFill(f, x, z)) return 'fill';
      return 'hall';
    }

    // ---- seal slivers: where two walls face each other across a gap narrower than SLIVER (room / room, room / stairwell,
    // room / courtyard, room / outer wall) the plan shows solid wall, so the gap becomes a solid block
    for (const f of [1, 2]) {
      const edges = [];
      const addPoly = (poly, owner, flip, skip) => {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.3 || (skip && skip(a, b))) continue;
          const s = flip ? -1 : 1;
          edges.push({ a, b, len, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: [s * (b[1] - a[1]) / len, -s * (b[0] - a[0]) / len], owner });
        }
      };
      rooms.filter(r => r.floor === f).forEach((r, i) => addPoly(r.poly, 'r' + i));
      stairs.forEach((st, i) => addPoly(wind(st.box), 's' + i, false, (a, b) => {
        // never seal a stairwell's entry face
        const [u0] = toLocal(st, a[0], a[1]), [u1] = toLocal(st, b[0], b[1]);
        return Math.abs(u0) < 0.05 && Math.abs(u1) < 0.05;
      }));
      addPoly(wind(outline[f].poly), 'out', true);
      if (f === 1) courts.forEach((c, i) => addPoly(c.poly, 'c' + i));
      for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
        const e1 = edges[i], e2 = edges[j];
        if (e1.owner === e2.owner || e1.n[0] * e2.n[0] + e1.n[1] * e2.n[1] > -0.97) continue;
        const gap = (e2.a[0] - e1.a[0]) * e1.n[0] + (e2.a[1] - e1.a[1]) * e1.n[1];
        if (gap < 0.04 || gap > SLIVER) continue;
        const s1 = (e2.a[0] - e1.a[0]) * e1.d[0] + (e2.a[1] - e1.a[1]) * e1.d[1], s2 = (e2.b[0] - e1.a[0]) * e1.d[0] + (e2.b[1] - e1.a[1]) * e1.d[1];
        const lo = Math.max(0, Math.min(s1, s2)), hi = Math.min(e1.len, Math.max(s1, s2));
        if (hi - lo < 0.3) continue;
        const P = t => [e1.a[0] + e1.d[0] * t, e1.a[1] + e1.d[1] * t];
        const p0 = P(lo), p1 = P(hi), q1 = [p1[0] + e1.n[0] * gap, p1[1] + e1.n[1] * gap], q0 = [p0[0] + e1.n[0] * gap, p0[1] + e1.n[1] * gap];
        const mid = [(p0[0] + q1[0]) / 2, (p0[1] + q1[1]) / 2];
        if (cell(f, mid[0], mid[1]) !== 'hall') continue;                    // only seal open hallway space
        fills.push({ floor: f, a: p0, d: e1.d, n: e1.n, lo: 0, hi: hi - lo, gap, poly: wind([p0, p1, q1, q0]) });
      }
    }

    // ---- classify room edges and place doors (where the room touches a hallway; else a courtyard; else a neighbour)
    for (const rm of rooms) {
      const P = rm.poly, n = P.length, big = ['gym', 'aud', 'cafe', 'library', 'lecture'].includes(rm.kind);
      const cand = [];
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;        // outward normal for clockwise polygons
        const samples = [0.5, 0.3, 0.7, 0.15, 0.85].map(t => {
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const c = cell(rm.floor, x + nx * 0.7, z + nz * 0.7), far = cell(rm.floor, x + nx * 1.6, z + nz * 1.6);
          // a hallway / courtyard door must open onto real space, not a sliver between two walls
          return { t, c, ok: c === 'room' ? far === 'room' || far === 'hall' : c === far };
        });
        const mid = samples[0].c;
        rm.edges.push({ a, b, len, nx, nz, side: mid === 'out' ? 'ext' : mid === 'court' ? 'court' : mid });
        if (len < 1.6) continue;
        for (const s of samples) {
          if (!s.ok) continue;
          const score = s.c === 'hall' ? 3 : s.c === 'court' ? 2 : s.c === 'room' ? 1 : 0;
          if (score) cand.push({ i, t: s.t, score: score + (s.t === 0.5 ? 0.2 : 0) + Math.min(len, 12) * 0.01, len, nx, nz, a, b });
        }
      }
      const forced = rm.opts.door;
      cand.sort((p, q) => q.score - p.score);
      if (forced && forced !== 'none') {
        // explicit door sides: the best candidate on each listed side
        const sideOf = c => Math.abs(c.nx) > Math.abs(c.nz) ? (c.nx > 0 ? 'e' : 'w') : (c.nz > 0 ? 's' : 'n');
        for (const sd of forced) {
          const c = cand.find(q => sideOf(q) === sd);
          if (!c) continue;
          const w = big ? 2.2 : 1.3, t = Math.max((w / 2 + 0.3) / c.len, Math.min(1 - (w / 2 + 0.3) / c.len, c.t));
          rm.doors.push({ edge: c.i, t, w, x: c.a[0] + (c.b[0] - c.a[0]) * t, z: c.a[1] + (c.b[1] - c.a[1]) * t, nx: c.nx, nz: c.nz });
        }
        continue;
      }
      const used = new Set(), want = big ? 3 : rm.kind === 'rest' || rm.kind === 'store' || rm.kind === 'mech' ? 1 : 2;
      for (const c of cand) {
        if (rm.doors.length >= want || forced === 'none') break;
        if (used.has(c.i)) continue;
        if (rm.doors.length && c.score < 2.5) break;                         // a second door only onto a hallway
        used.add(c.i);
        const w = big ? 2.2 : 1.3;
        const t = Math.max((w / 2 + 0.3) / c.len, Math.min(1 - (w / 2 + 0.3) / c.len, c.t));
        rm.doors.push({ edge: c.i, t, w, x: c.a[0] + (c.b[0] - c.a[0]) * t, z: c.a[1] + (c.b[1] - c.a[1]) * t, nx: c.nx, nz: c.nz });
      }
    }

    // a door that opens across a sealed sliver (into the neighbouring room) keeps a passage through the fill
    for (let k = fills.length - 1; k >= 0; k--) {
      const fl = fills[k];
      const cuts = [];
      for (const rm of rooms) if (rm.floor === fl.floor) for (const d of rm.doors) {
        if (Math.abs(d.nx * fl.n[0] + d.nz * fl.n[1]) < 0.9) continue;           // the door must face across the gap
        const t = (d.x - fl.a[0]) * fl.d[0] + (d.z - fl.a[1]) * fl.d[1], off = (d.x - fl.a[0]) * fl.n[0] + (d.z - fl.a[1]) * fl.n[1];
        if (off < -0.15 || off > fl.gap + 0.15 || t < fl.lo - d.w / 2 || t > fl.hi + d.w / 2) continue;
        cuts.push([t - d.w / 2 - 0.05, t + d.w / 2 + 0.05]);
      }
      if (!cuts.length) continue;
      cuts.sort((p, q) => p[0] - q[0]);
      const parts = [];
      let t = fl.lo;
      for (const [c0, c1] of cuts) { if (c0 - t > 0.3) parts.push([t, c0]); t = Math.max(t, c1); }
      if (fl.hi - t > 0.3) parts.push([t, fl.hi]);
      const P = (u, g) => [fl.a[0] + fl.d[0] * u + fl.n[0] * g, fl.a[1] + fl.d[1] * u + fl.n[1] * g];
      fills.splice(k, 1, ...parts.map(([u0, u1]) => ({ ...fl, lo: u0, hi: u1, poly: wind([P(u0, 0), P(u1, 0), P(u1, fl.gap), P(u0, fl.gap)]) })));
    }

    // every edge's door gaps: its own doors plus doors of rooms whose wall runs along it (nested / back-to-back rooms)
    const allDoors = rooms.flatMap(r => r.doors.map(d => ({ ...d, room: r })));
    for (const rm of rooms) rm.edges.forEach((e, i) => {
      e.gaps = [];
      for (const d of allDoors) {
        if (d.room.floor !== rm.floor) continue;
        const own = d.room === rm && d.edge === i;
        if (!own) {
          // the wall this door runs into: facing it across a thin sliver (< 0.8 m), or on the same line (nested rooms)
          const dot = d.nx * e.nx + d.nz * e.nz, dist = segDist(d.x, d.z, e.a[0], e.a[1], e.b[0], e.b[1]);
          if (d.room === rm || !((dot < -0.9 && dist < 0.8) || (dot > 0.9 && dist < 0.4))) continue;
        }
        const t = ((d.x - e.a[0]) * (e.b[0] - e.a[0]) + (d.z - e.a[1]) * (e.b[1] - e.a[1])) / (e.len * e.len);
        if (t < -0.01 || t > 1.01) continue;
        e.gaps.push({ t0: t - d.w / 2 / e.len, t1: t + d.w / 2 / e.len, own, door: d });
      }
      // an exterior door that leads straight into a room opens the room's wall too
      if (rm.floor === 1) for (const [, dx, dy] of F1_DOORS) {
        const [x, z] = W([dx, dy]);
        if (segDist(x, z, e.a[0], e.a[1], e.b[0], e.b[1]) > 1.0) continue;
        const t = ((x - e.a[0]) * (e.b[0] - e.a[0]) + (z - e.a[1]) * (e.b[1] - e.a[1])) / (e.len * e.len);
        const out = (x - e.a[0]) * e.nx + (z - e.a[1]) * e.nz;
        // the whole door must fit on this wall, and sit on its outer side (not at a corner between two rooms)
        if (t - 1.1 / e.len < 0 || t + 1.1 / e.len > 1 || out < -0.3) continue;
        e.gaps.push({ t0: t - 1.1 / e.len, t1: t + 1.1 / e.len, own: false, door: { x, z, nx: e.nx, nz: e.nz, w: 2.2, ext: true } });
      }
    });

    // ---- collision walls: {a, b, y0, y1}
    const walls = [];
    const F1H = [0, CEIL], F2H = [F2Y, ROOF - 0.1];
    function pushGapped(a, b, gaps, y0, y1, extra) {
      // gaps: [{t0, t1}] along a->b (0..1)
      gaps = gaps.slice().sort((p, q) => p.t0 - q.t0);
      let t = 0;
      for (const g of gaps) { if (g.t0 > t) walls.push({ a: lerp2(a, b, t), b: lerp2(a, b, g.t0), y0, y1, ...extra }); t = Math.max(t, g.t1); }
      if (t < 1) walls.push({ a: lerp2(a, b, t), b: lerp2(a, b, 1), y0, y1, ...extra });
    }
    const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const gapAt = (a, b, x, z, w) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (len * len);
      return { t0: t - w / 2 / len, t1: t + w / 2 / len, t };
    };
    for (const rm of rooms) {
      const H = rm.floor === 1 ? F1H : F2H;
      rm.edges.forEach((e, i) => {
        pushGapped(e.a, e.b, e.gaps, H[0], H[1], { kind: 'room' });
      });
    }
    // building outline (with exterior doors), courtyards (glass, with doors)
    const extDoors = F1_DOORS.map(([name, x, y]) => ({ name, p: W([x, y]) }));
    for (const f of [1, 2]) {
      const P = outline[f].poly, H = f === 1 ? [0, F2Y] : [F2Y, ROOF];
      for (let i = 0; i < P.length; i++) {
        if (outline[f].open[i]) continue;
        const a = P[i], b = P[(i + 1) % P.length];
        const gaps = f === 1 ? extDoors.filter(d => segDist(d.p[0], d.p[1], a[0], a[1], b[0], b[1]) < 1.2).map(d => gapAt(a, b, d.p[0], d.p[1], 2.2)) : [];
        pushGapped(a, b, gaps, H[0], H[1], { kind: 'ext', floor: f });
      }
    }
    for (const c of courts) {
      const P = c.poly;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const gaps = c.doors.filter(d => segDist(d[0], d[1], a[0], a[1], b[0], b[1]) < 1.2).map(d => gapAt(a, b, d[0], d[1], 2.0));
        pushGapped(a, b, gaps, 0, CEIL, { kind: 'court' });
      }
    }
    // atrium railings on floor 2
    for (const v of voids) for (let i = 0; i < v.poly.length; i++) walls.push({ a: v.poly[i], b: v.poly[(i + 1) % v.poly.length], y0: CEIL, y1: F2Y + 1.1, kind: 'rail' });
    // the rotunda: a glass drum with a door to the outside (north) and one into the building (south), columns outside
    const DN = 28;
    for (let i = 0; i < DN; i++) {
      const a0 = (i / DN) * Math.PI * 2, a1 = ((i + 1) / DN) * Math.PI * 2, am = (a0 + a1) / 2;
      const sMid = Math.sin(am);
      if (Math.abs(Math.cos(am)) < 0.2 && sMid < 0) continue;                 // front doors (north, -z)
      if (Math.abs(Math.cos(am)) < 0.42 && sMid > 0) continue;                // the neck into the Nobel commons
      walls.push({ a: [dome.x + Math.cos(a0) * dome.r, dome.z + Math.sin(a0) * dome.r], b: [dome.x + Math.cos(a1) * dome.r, dome.z + Math.sin(a1) * dome.r], y0: 0, y1: ROOF, kind: 'dome' });
    }
    const columns = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;                                        // two columns flank the front doors (north)
      if (Math.sin(a) > 0.55) continue;                                       // none where the drum meets the building
      columns.push([dome.x + Math.cos(a) * dome.cols, dome.z + Math.sin(a) * dome.cols]);
    }
    for (const [cx, cz] of columns) {
      const r = 0.5;
      for (let k = 0; k < 6; k++) {
        const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
        walls.push({ a: [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], b: [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r], y0: 0, y1: ROOF, kind: 'column' });
      }
    }
    // stairwells
    for (const st of stairs) {
      const L = (u, v) => toWorld(st, u, v);
      const sw = (u0, v0, u1, v1, y0, y1, kind = 'stair') => walls.push({ a: L(u0, v0), b: L(u1, v1), y0, y1, kind });
      if (st.type === 'straight') {
        sw(0, 0, st.l, 0, 0, ROOF); sw(0, st.w, st.l, st.w, 0, ROOF);         // both sides (railings upstairs)
        sw(st.l, 0, st.l, st.w, 0, F2Y - 0.4);                                // under the top end on floor 1
        sw(0, 0, 0, st.w, F2Y - 1.2, ROOF);                                   // the hole's edge at the bottom end, upstairs
      } else {
        const half = st.w / 2, run = st.l - st.landing, lowL = st.up === 'L';
        sw(0, 0, st.l, 0, 0, ROOF); sw(0, st.w, st.l, st.w, 0, ROOF); sw(st.l, 0, st.l, st.w, 0, ROOF);
        sw(0, half, run, half, 0, ROOF, 'stairmid');                          // the wall between the flights
        const lowV = lowL ? [0, half] : [half, st.w], hiV = lowL ? [half, st.w] : [0, half];
        sw(0, hiV[0], 0, hiV[1], 0, F2Y - 1.6);                               // floor 1: under the upper flight
        sw(0, lowV[0], 0, lowV[1], F2Y - 1.2, ROOF);                          // floor 2: the stairwell hole
        // a door in each entrance (floor 1 into the lower flight, floor 2 off the upper flight); jambs either side
        for (const [lane, y0] of [[lowV, 0], [hiV, F2Y]]) {
          const c = (lane[0] + lane[1]) / 2, d0 = c - STAIR_DOOR / 2, d1 = c + STAIR_DOOR / 2;
          sw(0, lane[0], 0, d0, y0, y0 + 2.4, 'stairdoor'); sw(0, d1, 0, lane[1], y0, y0 + 2.4, 'stairdoor');
        }
      }
    }

    for (const fl of fills) {
      const H = fl.floor === 1 ? F1H : F2H;
      for (let i = 0; i < 4; i++) walls.push({ a: fl.poly[i], b: fl.poly[(i + 1) % 4], y0: H[0], y1: H[1], kind: 'fill' });
    }

    // ---- floor height under a point; y = the walker's current feet height (stairs need it)
    function ground(x, z, y) {
      let best = 0;
      const st = inStairBox(x, z);
      if (st) {
        const [u, v] = toLocal(st, x, z);
        const h = stairHeight(st, Math.max(0, Math.min(st.l, u)), Math.max(0, Math.min(st.w, v)));
        if (h !== null && h <= y + 0.7) best = Math.max(best, h);
        return best;
      }
      if (y > F2Y - 1.2 && insideFloor(2, x, z)) best = F2Y;
      return best;
    }

    // ---- where am I (for the log and the HUD)
    const labels = LABELS.map(([f, name, x, y]) => ({ floor: f, name, p: W(f === 2 ? T2(x, y) : [x, y]) }));
    function locate(x, y, z) {
      const f = y > F2Y - 1 ? 2 : 1;
      const rm = roomAt(f, x, z);
      if (rm) return { floor: f, name: /^\d/.test(rm.name) ? 'Room ' + rm.name : rm.name };
      if (f === 1 && inDome(x, z)) return { floor: 1, name: 'the Dome' };
      const ct = f === 1 && inCourt(x, z);
      if (ct) return { floor: 1, name: 'the ' + ct.name };
      const st = inStairBox(x, z);
      if (st) return { floor: f, name: 'the ' + st.name };
      if (!insideFloor(f, x, z)) return { floor: 1, name: 'outside' };
      let near = null, d = Infinity;
      for (const l of labels) if (l.floor === f) { const dd = Math.hypot(l.p[0] - x, l.p[1] - z); if (dd < d) { d = dd; near = l; } }
      return { floor: f, name: near ? near.name : 'a hallway' };
    }

    /** A legal hiding spot: inside the school (courtyards and the dome count), within reach of the floor. */
    function validSpot(x, y, z) {
      if (![x, y, z].every(Number.isFinite)) return false;
      const f = y > F2Y - 0.3 ? 2 : 1, base = f === 2 ? F2Y : 0;
      if (y < base - 0.1 || y > base + 2.6) return false;
      if (inFill(f, x, z)) return false;                                       // sealed space
      if (f === 1) return pointInPoly(x, z, out1) || inDome(x, z);
      return insideFloor(2, x, z) || !!inStairBox(x, z);
    }

    const spawn = { x: W([918, 222])[0], y: 0, z: W([918, 222])[1], yaw: Math.PI };   // outside the Dome, facing it
    return { SCALE, F2Y, CEIL, ROOF, STAIR_DOOR, rooms, courts, outline, voids, stairs, fills, walls, labels, dome, columns, extDoors, spawn,
             ground, locate, validSpot, cell, insideFloor, roomAt, stairHeight, toLocal, toWorld, pointInPoly, centroid, bbox, segDist,
             bounds: { x0: -190, x1: 175, z0: -150, z1: 120 } };
  }

  return { build, SCALE, F2Y, CEIL, ROOF, T2, W, F1_OUTLINE, F2_OUTLINE, F1_ROOMS, F2_ROOMS, STAIRS, COURTS };
});
