#pragma once

// Original deterministic weather simulation; no meteorological data is used.
// This engine-independent kernel is also exercised by the native CPU tests.
#include <algorithm>
#include <cmath>

namespace NeivaWeather
{
enum class Mode { Cycle, Dry, Rain };
enum class Phase { Dry, Increasing, Rain, Decreasing };

struct Cycle
{
    Mode CurrentMode = Mode::Cycle;
    Phase CurrentPhase = Phase::Dry;
    double PhaseSeconds = 0;
    double TotalSeconds = 0;
    double Wetness = 0;
    double StartRain = 0;

    double Duration() const
    {
        switch (CurrentPhase)
        {
        case Phase::Dry: return 45;
        case Phase::Increasing: return 15;
        case Phase::Rain: return 60;
        case Phase::Decreasing: return 20;
        }
        return 45;
    }

    double RainAt(double Seconds) const
    {
        if (CurrentPhase == Phase::Dry) return 0;
        if (CurrentPhase == Phase::Rain) return 1;
        const double T = std::clamp(Seconds / Duration(), 0., 1.);
        const double End = CurrentPhase == Phase::Increasing ? 1. : 0.;
        return StartRain + (End - StartRain) * T * T * (3 - 2 * T);
    }
    double RainAmount() const { return RainAt(PhaseSeconds); }
    bool Holding() const
    {
        return (CurrentMode == Mode::Dry && CurrentPhase == Phase::Dry) ||
               (CurrentMode == Mode::Rain && CurrentPhase == Phase::Rain);
    }
    double SecondsUntilChange() const { return Holding() ? -1. : Duration() - PhaseSeconds; }

    void SetMode(Mode Requested)
    {
        if (Requested == CurrentMode) return;
        CurrentMode = Requested;
        if (Requested == Mode::Cycle) return;
        const Phase Transition = Requested == Mode::Rain ? Phase::Increasing : Phase::Decreasing;
        const Phase Stable = Requested == Mode::Rain ? Phase::Rain : Phase::Dry;
        if (CurrentPhase == Transition || CurrentPhase == Stable) return;
        StartRain = RainAmount();
        CurrentPhase = Transition;
        PhaseSeconds = 0;
    }

    // Exact solution of tau*w' + w = rain(t), where each phase's rain is a
    // cubic smoothstep. Integration is independent of frame partitioning.
    double Particular(double T, double Tau) const
    {
        if (CurrentPhase == Phase::Dry) return 0;
        if (CurrentPhase == Phase::Rain) return 1;
        const double D = Duration();
        const double Delta = (CurrentPhase == Phase::Increasing ? 1. : 0.) - StartRain;
        const double First = Delta * (6 * T / (D * D) - 6 * T * T / (D * D * D));
        const double Second = Delta * (6 / (D * D) - 12 * T / (D * D * D));
        const double Third = -12 * Delta / (D * D * D);
        return RainAt(T) - Tau * First + Tau * Tau * Second - Tau * Tau * Tau * Third;
    }

    void Advance(double Seconds)
    {
        if (!std::isfinite(Seconds) || Seconds <= 0) return;
        TotalSeconds += Seconds;
        while (Seconds > 0)
        {
            const double Step = Holding() ? Seconds : std::min(Seconds, Duration() - PhaseSeconds);
            const double Tau = (CurrentPhase == Phase::Increasing || CurrentPhase == Phase::Rain) ? 18. : 55.;
            Wetness = std::clamp(Particular(PhaseSeconds + Step, Tau) +
                (Wetness - Particular(PhaseSeconds, Tau)) * std::exp(-Step / Tau), 0., 1.);
            PhaseSeconds += Step;
            Seconds -= Step;
            if (Holding()) { PhaseSeconds = 0; break; }
            if (PhaseSeconds >= Duration() - 1.e-10)
            {
                StartRain = RainAt(Duration());
                switch (CurrentPhase)
                {
                case Phase::Dry: CurrentPhase = Phase::Increasing; break;
                case Phase::Increasing: CurrentPhase = Phase::Rain; break;
                case Phase::Rain: CurrentPhase = Phase::Decreasing; break;
                case Phase::Decreasing: CurrentPhase = Phase::Dry; break;
                }
                PhaseSeconds = 0;
            }
        }
    }
};
}
