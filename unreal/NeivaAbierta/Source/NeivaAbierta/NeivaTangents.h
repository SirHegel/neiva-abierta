#pragma once

// Engine-independent tangent kernel, exercised by native geometry tests.
// O(vertices + indices) time and O(vertices) scratch memory. Readers avoid
// copying UE position/normal/UV arrays. Only shared INDICES accumulate: UV
// seams and hard edges must retain their authored split vertices.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace NeivaTangents
{
    struct FVector3
    {
        double X = 0, Y = 0, Z = 0;
        FVector3 operator+(const FVector3& V) const { return {X + V.X, Y + V.Y, Z + V.Z}; }
        FVector3 operator-(const FVector3& V) const { return {X - V.X, Y - V.Y, Z - V.Z}; }
        FVector3 operator*(double S) const { return {X * S, Y * S, Z * S}; }
        double Dot(const FVector3& V) const { return X * V.X + Y * V.Y + Z * V.Z; }
        FVector3 Cross(const FVector3& V) const { return {Y * V.Z - Z * V.Y, Z * V.X - X * V.Z, X * V.Y - Y * V.X}; }
        FVector3 Unit() const
        {
            const double Length = std::hypot(X, Y, Z);
            return std::isfinite(Length) && Length > 1e-15 ? *this * (1.0 / Length) : FVector3{};
        }
        bool IsZero() const { return X == 0 && Y == 0 && Z == 0; }
    };

    template<class V> FVector3 ReadVector(const V& P) { return {P.X, P.Y, P.Z}; }

    inline FVector3 Perpendicular(const FVector3& Normal)
    {
        // Project the least parallel axis for a stable degenerate-UV fallback.
        const double X = std::abs(Normal.X), Y = std::abs(Normal.Y), Z = std::abs(Normal.Z);
        const FVector3 Axis = X <= Y && X <= Z ? FVector3{1, 0, 0}
            : Y <= Z ? FVector3{0, 1, 0} : FVector3{0, 0, 1};
        return (Axis - Normal * Normal.Dot(Axis)).Unit();
    }

    template<class PositionReader, class IndexReader, class NormalReader, class UVReader, class OutputWriter>
    void Calculate(std::size_t VertexCount, std::size_t IndexCount,
        PositionReader PositionAt, IndexReader IndexAt, NormalReader NormalAt, UVReader UVAt, OutputWriter Write)
    {
        struct FAccumulated { FVector3 Tangent, Bitangent; };
        std::vector<FAccumulated> Accumulated(VertexCount);
        for (std::size_t Triangle = 0; Triangle < IndexCount / 3; ++Triangle)
        {
            const std::int64_t A = IndexAt(Triangle * 3), B = IndexAt(Triangle * 3 + 1), C = IndexAt(Triangle * 3 + 2);
            if (A < 0 || B < 0 || C < 0 || static_cast<std::size_t>(A) >= VertexCount ||
                static_cast<std::size_t>(B) >= VertexCount || static_cast<std::size_t>(C) >= VertexCount) continue;
            const FVector3 Edge1 = ReadVector(PositionAt(B)) - ReadVector(PositionAt(A));
            const FVector3 Edge2 = ReadVector(PositionAt(C)) - ReadVector(PositionAt(A));
            if (Edge1.Cross(Edge2).Unit().IsZero()) continue;
            const auto UV0 = UVAt(A), UV1 = UVAt(B), UV2 = UVAt(C);
            const double DU1 = UV1.X - UV0.X, DV1 = UV1.Y - UV0.Y;
            const double DU2 = UV2.X - UV0.X, DV2 = UV2.Y - UV0.Y;
            const double Det = DU1 * DV2 - DU2 * DV1;
            const double Scale = std::max(std::abs(DU1 * DV2), std::abs(DU2 * DV1));
            if (!std::isfinite(Det) || Scale <= 1e-30 || std::abs(Det) <= Scale * 1e-12) continue;
            // Equal contribution per face, matching Kismet's normalized UV
            // directions without its position-based smoothing or normal output.
            const FVector3 Tangent = ((Edge1 * DV2 - Edge2 * DV1) * (1.0 / Det)).Unit();
            const FVector3 Bitangent = ((Edge2 * DU1 - Edge1 * DU2) * (1.0 / Det)).Unit();
            if (Tangent.IsZero() || Bitangent.IsZero()) continue;
            for (const std::int64_t Index : {A, B, C})
            {
                auto& Sum = Accumulated[static_cast<std::size_t>(Index)];
                Sum.Tangent = Sum.Tangent + Tangent;
                Sum.Bitangent = Sum.Bitangent + Bitangent;
            }
        }
        for (std::size_t Index = 0; Index < VertexCount; ++Index)
        {
            FVector3 Normal = ReadVector(NormalAt(Index)).Unit();
            if (Normal.IsZero()) Normal = {0, 0, 1}; // Basis only; never overwrite authored normals.
            const auto& Sum = Accumulated[Index];
            FVector3 Tangent = (Sum.Tangent - Normal * Normal.Dot(Sum.Tangent)).Unit();
            if (Tangent.IsZero()) Tangent = Perpendicular(Normal);
            // PMC reconstructs B = cross(N,T) * (bFlipTangentY ? -1 : +1).
            const bool Flip = Normal.Cross(Tangent).Dot(Sum.Bitangent) < 0;
            Write(Index, Tangent, Flip);
        }
    }
}
