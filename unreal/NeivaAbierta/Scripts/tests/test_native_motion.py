"""Compile only the engine-independent integrator, not an Unreal game binary."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest


class NativeMotionTests(unittest.TestCase):
    def test_real_native_integrator_preserves_time_braking_reverse_and_debt(self):
        compiler = shutil.which('g++') or shutil.which('clang++')
        if not compiler:
            self.skipTest('A C++17 compiler is required for the portable integration test')
        header = pathlib.Path(__file__).resolve().parents[2] / 'Source/NeivaAbierta/NeivaMotion.h'
        code = r'''
#include "NeivaMotion.h"
#include <cassert>
#include <limits>
using namespace NeivaMotion;
int main() {
 double baselineX=0, baselineY=0;
 for (int fps : {10,15,30,60,120}) {
  FClock clock; FVehicleState state; double x=0,y=0;
  for(int frame=0;frame<fps*8;frame++)clock.Advance(1.0/fps,[&](double dt){
    auto d=Step(state,{1,.28,false},dt);x+=d.X;y+=d.Y;});
  assert(state.Speed<=20 && state.Speed>19.9);assert(clock.Debt<1e-7);
  if(fps==10){baselineX=x;baselineY=y;}
  else {assert(std::abs(x-baselineX)<1e-8);assert(std::abs(y-baselineY)<1e-8);}
 }
 FVehicleState braking; braking.Speed=10;double distance=0;
 for(int i=0;i<60;i++)distance+=Step(braking,{0,0,true},1.0/60).X;
 assert(std::abs(distance-5)<1e-8);assert(braking.Speed<1e-8 && braking.Speed>=0);
 for(int i=0;i<120;i++)Step(braking,{0,0,true},1.0/60);
 assert(braking.Speed==0);
 FVehicleState reverse;
 for(int i=0;i<60;i++)Step(reverse,{-1,1,false},1.0/60);
 assert(reverse.Speed>=-4.5 && reverse.Speed<0 && reverse.Yaw<0);
 FClock debt;int calls=0;debt.Advance(3,[&](double){calls++;});
 assert(calls==120 && std::abs(debt.Debt-1)<1e-7);
 debt.Advance(0,[&](double){calls++;});assert(calls==180 && debt.Debt<1e-7);
 debt.Reset();assert(debt.Advance(std::numeric_limits<double>::infinity(),[](double){})==0);
}
'''
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'motion.cpp'
            binary = pathlib.Path(folder) / 'motion-test'
            source.write_text(code)
            subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I', str(header.parent), str(source), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)
