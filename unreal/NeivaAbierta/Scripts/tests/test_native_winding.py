"""Exercise production mesh generators without launching Unreal.

UE 5.5 GenerateBoxMesh uses clockwise indices opposite the authored outward
normal. PMC passes bFlipNormals=true to Chaos, which swaps the first two indices.
These tests check that contract; they do not replace an actual walkability test.
"""
import json
import math
import pathlib
import shutil
import subprocess
import tempfile
import unittest


PROJECT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = PROJECT / "Source/NeivaAbierta"


def function(source, signature):
    """Extract an actual balanced C++ function, including its signature."""
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


class NativeWindingTests(unittest.TestCase):
    def test_actual_generators_and_landmark_conversion_match_unreal_faces(self):
        compiler = shutil.which("g++") or shutil.which("clang++")
        if not compiler:
            self.skipTest("A C++17 compiler is required for the portable geometry test")
        world = (SOURCE / "NeivaWorld.cpp").read_text()
        landmarks = (SOURCE / "NeivaLandmarks.cpp").read_text()
        geometry = world[world.index("struct FMapGeometry"):world.index("void Upload(")]
        geometry += "};"
        methods = "\n".join(function(world, signature) for signature in (
            "double Cross2(", "void Face(", "void Extrude(", "void Ribbon("))
        convert = function(landmarks, "FVector Convert(")
        import_indices = landmarks[landmarks.index("for (const auto& Index : RawIndices)"):
                                   landmarks.index("// Tangents share indices only;")]
        shim = r'''
#include <algorithm>
#include <cassert>
#include <cmath>
#include <initializer_list>
#include <memory>
#include <vector>
using int32 = int;
template<class T> struct TArray : std::vector<T> {
 using std::vector<T>::vector;
 int Num() const {return static_cast<int>(this->size());}
 void Add(T v) {this->push_back(v);}
 void Append(std::initializer_list<T> v) {this->insert(this->end(),v);}
 void RemoveAt(int i) {this->erase(this->begin()+i);}
};
template<class T> void Swap(T& a,T& b) {std::swap(a,b);}
namespace Algo {template<class T> void Reverse(T& v) {std::reverse(v.begin(),v.end());}}
namespace FMath {double Abs(double v) {return std::abs(v);}}
struct FVector {
 double X=0,Y=0,Z=0;
 FVector()=default;
 FVector(double x,double y,double z):X(x),Y(y),Z(z) {}
 FVector operator+(FVector v) const {return {X+v.X,Y+v.Y,Z+v.Z};}
 FVector operator-(FVector v) const {return {X-v.X,Y-v.Y,Z-v.Z};}
 FVector operator*(double v) const {return {X*v,Y*v,Z*v};}
 static FVector CrossProduct(FVector a,FVector b) {
  return {a.Y*b.Z-a.Z*b.Y,a.Z*b.X-a.X*b.Z,a.X*b.Y-a.Y*b.X};
 }
 FVector GetSafeNormal() const {double l=std::hypot(X,Y,Z);return l>1e-12?*this*(1/l):FVector{};}
 FVector GetAbs() const {return {std::abs(X),std::abs(Y),std::abs(Z)};}
 bool IsNearlyZero() const {return std::hypot(X,Y,Z)<1e-12;}
};
struct FVector2D {
 double X,Y;
 FVector2D(double x,double y):X(x),Y(y) {}
 FVector2D operator/(double v) const {return {X/v,Y/v};}
};
struct FLinearColor {};
struct Number {double Value;double AsNumber() const {return Value;}};
using FNumbers = TArray<std::shared_ptr<Number>>;
FNumbers numbers(std::initializer_list<double> values) {
 FNumbers result;for(double v:values)result.Add(std::make_shared<Number>(Number{v}));return result;
}
double dot(FVector a,FVector b) {return a.X*b.X+a.Y*b.Y+a.Z*b.Z;}
bool near(FVector a,FVector b) {return (a-b).IsNearlyZero();}
'''
        assertions = r'''
void check(const FMapGeometry& g) {
 assert(g.Indices.Num()%3==0 && g.Vertices.Num()==g.Normals.Num());
 assert(g.Vertices.Num()==g.UVs.Num() && g.Vertices.Num()==g.Colors.Num());
 for(int i=0;i<g.Indices.Num();i+=3) {
  const int a=g.Indices.at(i),b=g.Indices.at(i+1),c=g.Indices.at(i+2);
  auto normal=g.Normals.at(a);
  auto renderCross=FVector::CrossProduct(g.Vertices.at(b)-g.Vertices.at(a),g.Vertices.at(c)-g.Vertices.at(a));
  assert(dot(renderCross,normal)<0); // Same front-face contract as UE's box top.
  auto chaosCross=FVector::CrossProduct(g.Vertices.at(a)-g.Vertices.at(b),g.Vertices.at(c)-g.Vertices.at(b));
  assert(dot(chaosCross,normal)>0);  // PMC bFlipNormals swaps a and b in Chaos.
 }
}
int main() {
 TArray<FVector> square={{-100,-100,0},{100,-100,0},{100,100,0},{-100,100,0}};
 for(int reverse=0;reverse<2;++reverse) {
  if(reverse)Algo::Reverse(square);
  FMapGeometry ground;Face(ground,square,{});check(ground);
  assert(ground.Indices.Num()==6);
  for(auto n:ground.Normals)assert(near(n,{0,0,1}));
  // Extruded walls must face away from the centre; roof must point upward.
  FMapGeometry building;Extrude(building,square,200,{});check(building);
  assert(building.Indices.Num()==30);
  for(int i=0;i<building.Vertices.Num();++i)
   assert(dot(building.Normals[i],building.Vertices[i]-FVector(0,0,100))>0);
 }
 FMapGeometry concave;Face(concave,{{0,0,0},{200,0,0},{200,100,0},{100,100,0},{100,200,0},{0,200,0}},{});
 check(concave);assert(concave.Indices.Num()==12);
 double area=0;
 for(int i=0;i<concave.Indices.Num();i+=3) {
  auto a=concave.Vertices[concave.Indices[i]],b=concave.Vertices[concave.Indices[i+1]],c=concave.Vertices[concave.Indices[i+2]];
  area+=std::abs(FVector::CrossProduct(b-a,c-a).Z)*.5;
 }
 assert(std::abs(area-30000)<1e-9);
 FMapGeometry road;Ribbon(road,{{0,0,0},{200,0,0},{200,200,0}},100,{});check(road);
 for(auto n:road.Normals)assert(near(n,{0,0,1}));
 const int before=road.Vertices.Num();road.Triangle({0,0,0},{1,0,0},{2,0,0},{});
 assert(road.Vertices.Num()==before);check(road);
 // Run the actual landmark conversion and index loop, including multiple faces.
 auto indices=ImportIndices(numbers({0,1,2,3,4,5}));
 assert(indices.Num()==6);
 auto raw=numbers({0,0,0, 1,0,0, 0,0,-1}); // Upward Three triangle.
 auto a=Convert(raw,indices[0]*3,100),b=Convert(raw,indices[1]*3,100),c=Convert(raw,indices[2]*3,100);
 auto normal=Convert(numbers({0,1,0}),0,1);
 assert(near(normal,{0,0,1}));assert(dot(FVector::CrossProduct(b-a,c-a),normal)<0);
 assert(indices[3]==3 && indices[4]==5 && indices[5]==4);
 assert(near(Convert(numbers({2,3,4}),0,100),{200,-400,300}));
}
'''
        code = shim + geometry + methods + convert
        code += "TArray<int32> ImportIndices(const FNumbers& RawIndices) {TArray<int32> Indices;"
        code += import_indices + "return Indices;}" + assertions
        with tempfile.TemporaryDirectory(prefix="neiva-winding-test-") as folder:
            source = pathlib.Path(folder) / "winding.cpp"
            binary = pathlib.Path(folder) / "winding-test"
            source.write_text(code)
            subprocess.run([compiler, "-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror",
                            str(source), "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_all_authored_landmark_triangles_need_one_flip_not_changed_normals(self):
        data = json.loads((PROJECT / "SourceArt/landmarks/neiva-landmarks.json").read_text())
        triangles = 0
        for mesh in data["meshes"]:
            positions, normals, indices = mesh["positions"], mesh["normals"], mesh["indices"]
            for offset in range(0, len(indices), 3):
                a, b, c = [indices[offset + k] * 3 for k in range(3)]
                u = [positions[b + k] - positions[a + k] for k in range(3)]
                v = [positions[c + k] - positions[a + k] for k in range(3)]
                cross = (u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0])
                normal = [normals[a + k] + normals[b + k] + normals[c + k] for k in range(3)]
                length = math.hypot(*cross) * math.hypot(*normal)
                alignment = sum(cross[k] * normal[k] for k in range(3))
                self.assertGreater(length, 1e-10, f"Degenerate landmark face {offset//3}")
                self.assertGreater(alignment / length, 1e-6, "Source indices must face along Three normals")
                # The coordinate rotation preserves dot and orientation; one
                # winding flip makes the rendered cross oppose the SAME normal.
                native_cross = (-cross[0], cross[2], -cross[1])
                native_normal = (normal[0], -normal[2], normal[1])
                self.assertLess(sum(x*y for x, y in zip(native_cross, native_normal)), 0)
                triangles += 1
        self.assertEqual(len(data["meshes"]), data["counts"]["meshes"])
        self.assertEqual(triangles, data["counts"]["triangles"])


if __name__ == "__main__":
    unittest.main()
