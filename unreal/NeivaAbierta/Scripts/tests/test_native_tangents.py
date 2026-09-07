"""Compile the actual portable tangent kernel; this does not launch Unreal."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest


class NativeTangentTests(unittest.TestCase):
    def test_uv_frames_hard_edges_degenerate_input_and_linear_vertex_access(self):
        compiler = shutil.which("g++") or shutil.which("clang++")
        if not compiler:
            self.skipTest("A C++17 compiler is required for the portable geometry test")
        headers = pathlib.Path(__file__).resolve().parents[2] / "Source/NeivaAbierta"
        code = r'''
#include "NeivaTangents.h"
#include <cassert>
#include <limits>
using NeivaTangents::FVector3;
struct UV { double X, Y; };
struct Frame { FVector3 T; bool Flip; };
using Vectors = std::vector<FVector3>;
using UVs = std::vector<UV>;
using Indices = std::vector<int>;
bool near(FVector3 a, FVector3 b) { return std::hypot(a.X-b.X,a.Y-b.Y,a.Z-b.Z)<1e-10; }
std::vector<Frame> calculate(const Vectors& p, const Indices& indices, const Vectors& n, const UVs& uv) {
 std::vector<Frame> result(p.size());
 NeivaTangents::Calculate(p.size(),indices.size(),[&](auto i){return p.at(i);},
  [&](auto i){return indices.at(i);},[&](auto i){return n.at(i);},[&](auto i){return uv.at(i);},
  [&](auto i,auto t,bool flip){result.at(i)={t,flip};});
 return result;
}
void orthonormal(const Frame& f, FVector3 n) {
 assert(std::isfinite(f.T.X) && std::isfinite(f.T.Y) && std::isfinite(f.T.Z));
 assert(std::abs(f.T.Dot(f.T)-1)<1e-10);
 assert(std::abs(f.T.Dot(n.Unit()))<1e-10);
}
int main() {
 const Vectors p={{0,0,0},{2,0,0},{0,3,0}};
 const Vectors n(3,{0,0,1});
 const UVs uv={{0,0},{1,0},{0,1}};
 const Indices tri={0,1,2};
 // Canonical UV frame: UE reconstructs B=N cross T with no flip.
 auto f=calculate(p,tri,n,uv);
 for(const auto& v:f) { assert(near(v.T,{1,0,0}));assert(!v.Flip);orthonormal(v,{0,0,1}); }
 // Mirroring U reverses T, requires a flip, and must still reconstruct +Y.
 auto mirrored=calculate(p,tri,n,{{0,0},{-1,0},{0,1}});
 for(const auto& v:mirrored) {
  assert(near(v.T,{-1,0,0}));assert(v.Flip);
  assert(near(FVector3{0,0,1}.Cross(v.T)*(v.Flip?-1:1),{0,1,0}));
 }
 // Reordering the triangle cannot reverse its UV frame or authored normal.
 auto reversed=calculate(p,{0,2,1},n,uv);
 for(std::size_t i=0;i<f.size();++i) {assert(near(f[i].T,reversed[i].T));assert(f[i].Flip==reversed[i].Flip);}
 auto back=calculate(p,tri,Vectors(3,{0,0,-1}),uv);
 assert(near(back[0].T,{1,0,0}) && back[0].Flip);
 // Authored smooth normals are Gram-Schmidt constraints, not face normals.
 Vectors smooth={{0,.6,.8},{.6,0,.8},{0,0,1}};
 const auto before=smooth;
 auto smoothed=calculate(p,tri,smooth,uv);
 for(std::size_t i=0;i<smooth.size();++i) {orthonormal(smoothed[i],smooth[i]);assert(near(before[i],smooth[i]));}
 assert(near(smoothed[1].T,{.8,0,-.6}));
 // Coincident positions with different indices retain their UV/hard-edge frame.
 Vectors split={{0,0,0},{1,0,0},{0,1,0},{0,0,0},{0,1,0},{0,0,1}};
 Vectors splitN={{0,0,1},{0,0,1},{0,0,1},{1,0,0},{1,0,0},{1,0,0}};
 auto edges=calculate(split,{0,1,2,3,4,5},splitN,{{0,0},{1,0},{0,1},{0,0},{1,0},{0,1}});
 assert(near(edges[0].T,{1,0,0}));assert(near(edges[3].T,{0,1,0}));
 assert(!edges[0].Flip && !edges[3].Flip);
 // Shared indices average only their incident valid triangle directions.
 auto shared=calculate({{0,0,0},{1,0,0},{0,1,0},{-1,0,0}}, {0,1,2,0,2,3},
  Vectors(4,{0,0,1}), {{0,0},{1,0},{0,1},{-1,1}});
 const double pi=std::acos(-1.0);
 assert(near(shared[0].T,{std::cos(pi/8),std::sin(pi/8),0}));
 assert(near(shared[1].T,{1,0,0}));
 assert(near(shared[3].T,{std::sqrt(.5),std::sqrt(.5),0}));
 // Zero-area/UV, invalid indices, isolated vertices: finite fallback frames.
 for(const auto& testUV : {UVs(3,{0,0}),UVs{{0,0},{1,0},{2,0}},
                          UVs{{0,0},{std::numeric_limits<double>::quiet_NaN(),0},{0,1}}}) {
  auto degenerate=calculate(p,{0,1,2,-1,1,2,0,1,99,0},n,testUV);
  for(const auto& v:degenerate) {orthonormal(v,{0,0,1});assert(!v.Flip);}
 }
 auto collapsed=calculate(Vectors(3,{0,0,0}),tri,n,uv);
 for(const auto& v:collapsed)orthonormal(v,{0,0,1});
 auto isolated=calculate(p,{},{{1,0,0},{0,1,0},{0,0,1}},uv);
 for(std::size_t i=0;i<3;++i)orthonormal(isolated[i],Vectors{{1,0,0},{0,1,0},{0,0,1}}[i]);
 auto invalidNormal=calculate(p,{},Vectors(3,{0,0,0}),uv);
 for(const auto& v:invalidNormal)orthonormal(v,{0,0,1});
 // Tiny yet non-degenerate UVs keep their frame; no absolute-det cutoff.
 auto tiny=calculate(p,tri,n,{{0,0},{1e-9,0},{0,1e-9}});
 assert(near(tiny[0].T,{1,0,0}) && !tiny[0].Flip);
 // Measured reader calls bound work independently of mesh size. No all-pairs scan.
 for(std::size_t triangles : {1u,100u,10000u}) {
  const std::size_t count=triangles*3;std::size_t positions=0,indices=0,normals=0,uvReads=0,writes=0;
  NeivaTangents::Calculate(count,count,[&](auto i){++positions;return p[i%3];},
   [&](auto i){++indices;return i;},[&](auto){++normals;return FVector3{0,0,1};},
   [&](auto i){++uvReads;return uv[i%3];},[&](auto,auto t,bool flip){++writes;assert(near(t,{1,0,0}) && !flip);});
  assert(positions==triangles*4 && indices==count && normals==count && uvReads==count && writes==count);
 }
}
'''
        with tempfile.TemporaryDirectory(prefix="neiva-tangent-test-") as folder:
            source = pathlib.Path(folder) / "tangents.cpp"
            binary = pathlib.Path(folder) / "tangent-test"
            source.write_text(code)
            subprocess.run([compiler, "-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", "-I", str(headers),
                            str(source), "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    unittest.main()
