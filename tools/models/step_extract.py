"""Extracts named, coloured, tessellated components from Adafruit's STEP file into tools/models/.cache/board.json.

Needs OCP (pip install cadquery-ocp). Run: python3 tools/models/step_extract.py <file.step>
Units are millimetres, Z up (the STEP frame). The cache is read by build.mjs and is not shipped.
"""
import json
import sys
from pathlib import Path

from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_Color
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label
from OCP.collections import Sequence_TDF_Label
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_DocumentTool, XCAFDoc_ShapeTool

src = Path(sys.argv[1])
out = Path(__file__).parent / ".cache" / "board.json"
out.parent.mkdir(parents=True, exist_ok=True)

app = XCAFApp_Application.GetApplication_s()
doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)
reader = STEPCAFControl_Reader()
reader.SetColorMode(True)
reader.SetNameMode(True)
if reader.ReadFile(str(src)) != IFSelect_RetDone or not reader.Transfer(doc):
    raise SystemExit("Could not read the STEP file")

shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())


def name_of(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ""


def color_of(label, shape=None):
    c = Quantity_Color()
    if shape is not None:
        for kind in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
            if colors.GetColor(shape, kind, c):
                return [round(c.Red(), 3), round(c.Green(), 3), round(c.Blue(), 3)]
    return None


def face_color(face):
    c = Quantity_Color()
    for kind in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
        if colors.GetColor(face, kind, c):
            return [round(c.Red(), 3), round(c.Green(), 3), round(c.Blue(), 3)]
    return None


def tessellate(shape, fallback):
    """Triangles grouped by face colour: {colour key: (colour, positions, indices)}."""
    BRepMesh_IncrementalMesh(shape, 0.05, False, 0.3, True)
    groups = {}
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            color = face_color(face) or fallback
            positions, indices = groups.setdefault(json.dumps(color), (color, [], []))[1:]
            trsf = loc.Transformation()
            base = len(positions) // 3
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(trsf)
                positions += [round(p.X(), 4), round(p.Y(), 4), round(p.Z(), 4)]
            flip = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                a, b, c = a - 1 + base, b - 1 + base, c - 1 + base
                indices += [a, c, b] if flip else [a, b, c]
        explorer.Next()
    return list(groups.values())


parts = []


def walk(label, path):
    here = path + [name_of(label)]
    if shapes.IsAssembly_s(label):
        children = Sequence_TDF_Label()
        shapes.GetComponents_s(label, children)
        for i in range(1, children.Length() + 1):
            walk(children.Value(i), here)
        return
    ref = TDF_Label()
    target = ref if shapes.GetReferredShape_s(label, ref) else label
    if target is not ref:
        target = label
    shape = shapes.GetShape_s(label)
    for color, positions, indices in tessellate(shape, color_of(label, shape)):
        parts.append({
            "name": name_of(target) or here[-1],
            "path": [p for p in here if p],
            "color": color,
            "positions": positions,
            "indices": indices,
        })


roots = Sequence_TDF_Label()
shapes.GetFreeShapes(roots)
for i in range(1, roots.Length() + 1):
    walk(roots.Value(i), [])

out.write_text(json.dumps({"source": src.name, "parts": parts}))
print(f"{len(parts)} components, {sum(len(p['indices']) // 3 for p in parts)} triangles ->", out)
for p in parts[:80]:
    print(f"  {p['name'][:28]:28} color={p['color']} tris={len(p['indices']) // 3}")
