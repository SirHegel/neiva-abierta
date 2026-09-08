"""Bounded 2D routing checks; these do not stand in for Unreal collision tests."""
import importlib.util
import json
from copy import deepcopy
from pathlib import Path
import unittest

PROJECT = Path(__file__).resolve().parents[2]
REPO = PROJECT.parents[1]
SPEC = importlib.util.spec_from_file_location('population', PROJECT / 'Scripts/prepare_population.py')
POP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POP)
SPEC_ENV = importlib.util.spec_from_file_location('environment', PROJECT / 'Scripts/prepare_environment.py')
ENV = importlib.util.module_from_spec(SPEC_ENV)
SPEC_ENV.loader.exec_module(ENV)


class PopulationRoutesTests(unittest.TestCase):
    def inputs(self):
        return json.loads((REPO/'public/data/neiva.json').read_text()), json.loads((REPO/'public/data/neiva-survey.json').read_text()), ENV.prepare(write=False)

    def test_real_routes_are_near_player_and_leave_all_source_geometry_unchanged(self):
        city, survey, environment = self.inputs()
        original = deepcopy((city, survey, environment))
        data = POP.make_population(city, survey, environment)
        self.assertEqual((city, survey, environment), original)
        self.assertEqual(len(data['routes']), 3)
        self.assertLess(min(r['distanceFromPlayerSpawnM'] for r in data['routes']), 21)
        self.assertTrue(all(r['closed'] and r['points'][0] == r['points'][-1] for r in data['routes']))
        self.assertTrue(all(r['clearance2D']['benchCenterM'] > 4 for r in data['routes']))
        self.assertFalse(data['verified']['groundedCapsule'])
        self.assertFalse(data['verified']['runtimePopulation'])

    def test_segment_intersection_is_not_missed_when_both_endpoints_are_inside(self):
        park = [[0,0],[20,0],[20,20],[14,20],[14,8],[6,8],[6,20],[0,20]]
        route = [[3,15],[17,15],[17,3],[3,3],[3,15]]
        self.assertTrue(all(POP.inside(p, park) for p in route))
        self.assertEqual(POP.boundary_distance(route, park), 0)
        with self.assertRaises(ValueError):
            POP.validate_route(route, park, [{'points': [[50,50],[60,50],[60,60]]}],
                {'trees':[{'x':50,'z':50}], 'benches':[{'x':60,'z':60}]},
                {'x':80,'z':80,'radius':2}, {'x':90,'z':90,'width':4,'depth':4})

    def test_new_furniture_on_route_fails_instead_of_silently_spawning_inside_it(self):
        city, survey, environment = self.inputs()
        x,z = POP.ROUTES['santander-south'][0]
        for kind in ['trees','benches']:
            changed = deepcopy(environment)
            changed[kind].append({'x':x,'z':z})
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                POP.make_population(city,survey,changed)

    def test_wrong_surface_or_origin_cannot_validate_routes(self):
        city, survey, environment = self.inputs()
        for field, value in [('id','other-park'), ('paved',False)]:
            changed = deepcopy(survey)
            changed['features']['santander'][field] = value
            with self.assertRaises(ValueError): POP.make_population(city,changed,environment)
        survey['origin'] = [0,0]
        with self.assertRaises(ValueError): POP.make_population(city,survey,environment)

    def test_check_uses_current_environment_plan_without_writing_previous_content(self):
        tracked = [REPO/'data/population-neiva.json',PROJECT/'Content/Data/neiva-population.json',PROJECT/'Content/Data/neiva-environment.json']
        before = {p:p.read_bytes() if p.exists() else None for p in tracked}
        result = POP.prepare(write=False,environment=ENV.prepare(write=False))
        self.assertTrue(result['verified']['geometry2D'])
        self.assertEqual(before,{p:p.read_bytes() if p.exists() else None for p in tracked})


if __name__ == '__main__': unittest.main()
