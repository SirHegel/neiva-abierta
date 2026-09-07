#pragma once

#include "CoreMinimal.h"
#include "ProceduralMeshComponent.h"
#include "NeivaTangents.h"

namespace Neiva
{
    inline void CalculateTangents(const TArray<FVector>& Vertices, const TArray<int32>& Indices,
        const TArray<FVector2D>& UVs, const TArray<FVector>& Normals, TArray<FProcMeshTangent>& Tangents)
    {
        Tangents.SetNumUninitialized(Vertices.Num());
        const bool HasNormals = Normals.Num() == Vertices.Num(), HasUVs = UVs.Num() == Vertices.Num();
        NeivaTangents::Calculate(static_cast<std::size_t>(Vertices.Num()), static_cast<std::size_t>(Indices.Num()),
            [&Vertices](std::size_t I) { return Vertices[static_cast<int32>(I)]; },
            [&Indices](std::size_t I) { return Indices[static_cast<int32>(I)]; },
            [&Normals, HasNormals](std::size_t I) { return HasNormals ? Normals[static_cast<int32>(I)] : FVector::UpVector; },
            [&UVs, HasUVs](std::size_t I) { return HasUVs ? UVs[static_cast<int32>(I)] : FVector2D::ZeroVector; },
            [&Tangents](std::size_t I, const NeivaTangents::FVector3& T, bool Flip) {
                Tangents[static_cast<int32>(I)] = FProcMeshTangent(FVector(T.X, T.Y, T.Z), Flip);
            });
    }
}
