import importlib.util
import pathlib
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("c5_wear_dry_run.py")


def load_module():
    spec = importlib.util.spec_from_file_location("c5_wear_dry_run", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class C5WearDryRunTests(unittest.TestCase):
    def test_extract_related_list_keeps_wear_labels_and_excludes_version_buttons(self):
        mod = load_module()
        html = """
        <html><body>
        <script>window.__NUXT__=(function(a){return {data:[{data:{
          relatedList:[
            {itemId:a,tag:"崭新出厂",enTag:"Factory New",marketHashName:"AK-47 | Test (Factory New)"},
            {itemId:"2",tag:"普通版",enTag:"Normal",marketHashName:"AK-47 | Test (Factory New)"},
            {itemId:"3",tag:"暗金",enTag:"StatTrak™",marketHashName:"StatTrak™ AK-47 | Test (Factory New)"},
            {itemId:"4",tag:"破损不堪",enTag:"Well-Worn",marketHashName:"AK-47 | Test (Well-Worn)"}
          ],
          categoryList:[
            {itemId:"5",tag:"纪念品",enTag:"Souvenir",marketHashName:"Souvenir AK-47 | Test (Factory New)"}
          ]
        }}]}}("1"));</script>
        </body></html>
        """

        related = mod.extract_related_list_from_html(html)
        wear_options = mod.filter_wear_options(related)

        self.assertEqual([item["itemId"] for item in wear_options], ["1", "4"])
        self.assertEqual([item["enTag"] for item in wear_options], ["Factory New", "Well-Worn"])

    def test_compute_new_range_uses_begin_end_not_value_text(self):
        mod = load_module()

        computed = mod.compute_new_wear_range(
            [{"begin": 0.05, "end": 0.07, "value": "0.04~0.07"}],
            [{"begin": 0.65, "end": 0.7, "value": "0.60~0.80"}],
        )

        self.assertEqual(computed["minfloat"], 0.05)
        self.assertEqual(computed["maxfloat"], 0.7)
        self.assertAlmostEqual(computed["wear_range"], 0.65)

    def test_classify_non_json_range_body_as_blocked_when_c5_check_page_appears(self):
        mod = load_module()

        blocked = mod.classify_non_json_response(
            "range",
            "\n<html><body onload=\"check()\"><input type=\"hidden\" name=\"parm_0\"></body></html>",
            200,
        )

        self.assertEqual(blocked.error_type, "range_c5_check_page")
        self.assertTrue(blocked.blocked)

    def test_build_families_keeps_stattrak_separate(self):
        mod = load_module()
        rows = [
            {
                "id": 1,
                "basemarkethashname": "AK-47 | Test",
                "basename": "AK-47 | 测试",
                "wearlevel": "Factory New",
                "c5id": "100",
                "minfloat": 0,
                "maxfloat": 1,
                "wear_range": 1,
            },
            {
                "id": 2,
                "basemarkethashname": "StatTrak™ AK-47 | Test",
                "basename": "AK-47（StatTrak™） | 测试",
                "wearlevel": "Factory New",
                "c5id": "200",
                "minfloat": 0,
                "maxfloat": 1,
                "wear_range": 1,
            },
        ]

        families = mod.build_families(rows)

        self.assertEqual(len(families), 2)
        self.assertEqual(
            {family["family_key"] for family in families},
            {"AK-47 | Test", "StatTrak™ AK-47 | Test"},
        )


if __name__ == "__main__":
    unittest.main()
