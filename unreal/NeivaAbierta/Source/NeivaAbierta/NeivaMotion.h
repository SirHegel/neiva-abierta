#pragma once

// Engine-independent SI-unit integration used by the native vehicle. The
// small native test executable verifies this exact code without claiming a UE build.
#include <algorithm>
#include <cmath>

namespace NeivaMotion
{
    inline double Approach(double Value, double Target, double Amount)
    { return Value + std::clamp(Target - Value, -Amount, Amount); }

    struct FVehicleState { double Speed = 0, Yaw = 0, Steering = 0; };
    struct FVehicleInput { double Throttle = 0, Steering = 0; bool Brake = false; };
    struct FDisplacement { double X = 0, Y = 0; };

    inline FDisplacement Step(FVehicleState& State, FVehicleInput Input, double DT)
    {
        if (!std::isfinite(DT) || DT <= 0) return {};
        Input.Throttle = std::isfinite(Input.Throttle) ? std::clamp(Input.Throttle, -1.0, 1.0) : 0;
        Input.Steering = std::isfinite(Input.Steering) ? std::clamp(Input.Steering, -1.0, 1.0) : 0;
        const double Previous = State.Speed;
        if (Input.Brake || Input.Throttle * Previous < 0)
            State.Speed = Approach(Previous, 0, 10 * DT);
        else if (Input.Throttle != 0)
            State.Speed = Approach(Previous, Input.Throttle > 0 ? 20 : -4.5,
                std::abs(Input.Throttle) * (Input.Throttle > 0 ? 6 : 3) * DT);
        else State.Speed = Approach(Previous, 0, (.65 + .003 * Previous * Previous) * DT);
        const double Fastest = std::max(std::abs(State.Speed), std::abs(Previous));
        const double Limit = std::min(.62, std::atan(6 * 2.55 / std::max(1.0, Fastest * Fastest)));
        State.Steering = std::clamp(Approach(State.Steering, Input.Steering * Limit, 2.8 * DT), -Limit, Limit);
        const double Average = (Previous + State.Speed) * .5;
        const double Turn = Average / 2.55 * std::tan(State.Steering) * DT;
        const double Heading = State.Yaw + Turn * .5;
        State.Yaw = std::atan2(std::sin(State.Yaw + Turn), std::cos(State.Yaw + Turn));
        return {std::cos(Heading) * Average * DT, std::sin(Heading) * Average * DT};
    }

    class FClock
    {
    public:
        double Debt = 0;
        template<class F> int Advance(double Elapsed, F&& Tick)
        {
            if (!std::isfinite(Elapsed) || Elapsed < 0) return 0;
            Debt += Elapsed;
            constexpr double StepSeconds = 1.0 / 60;
            int Count = 0;
            while (Debt + 1e-10 >= StepSeconds && Count < 120)
            {
                Tick(StepSeconds);
                Debt = std::max(0.0, Debt - StepSeconds);
                ++Count;
            }
            return Count;
        }
        void Reset() { Debt = 0; }
    };
}
