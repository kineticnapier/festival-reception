from pathlib import Path
import re


def remove_once(text: str, needle: str, label: str) -> str:
    count = text.count(needle)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(needle, "", 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text


page_path = Path("app/reception-page.tsx")
page = page_path.read_text()

for label, needle in [
    ("source state", "  const [sourceKnown, setSourceKnown] = useState(false);\n"),
    ("gender state", "  const [genderKnown, setGenderKnown] = useState(false);\n"),
    ("age state", "  const [ageKnown, setAgeKnown] = useState(false);\n"),
    ("source reset", "    setSourceKnown(false);\n"),
    ("gender reset", "    setGenderKnown(false);\n"),
    ("age reset", "    setAgeKnown(false);\n"),
]:
    page = remove_once(page, needle, label)

page = sub_once(
    page,
    r'  function selectSourcePreset\(next: SourcePreset\) \{.*?\n  \}\n\n  function changeStudentCount',
    '''  function selectSourcePreset(next: SourcePreset) {
  setSourcePreset(next);
  if (next === "mixed") {
    setMaleCount((current) => current ?? Math.round(partySize / 2));
    setAdultCount((current) => current ?? Math.round(partySize / 2));
  }
}

function changeStudentCount'''.replace("\n", "\n  ", 0),
    "preset",
)

# Fix indentation explicitly; the replacement above is intentionally simple.
page = page.replace(
    '''  function selectSourcePreset(next: SourcePreset) {
  setSourcePreset(next);
  if (next === "mixed") {
    setMaleCount((current) => current ?? Math.round(partySize / 2));
    setAdultCount((current) => current ?? Math.round(partySize / 2));
  }
}

function changeStudentCount''',
    '''  function selectSourcePreset(next: SourcePreset) {
    setSourcePreset(next);
    if (next === "mixed") {
      setMaleCount((current) => current ?? Math.round(partySize / 2));
      setAdultCount((current) => current ?? Math.round(partySize / 2));
    }
  }

  function changeStudentCount''',
    1,
)

page = sub_once(
    page,
    r'    const source: SourceCounts = sourcePreset === "mixed" && sourceKnown\n.*?  const mixedInvalid = sourcePreset === "mixed" && sourceKnown && gradeTotal > studentCount;\n',
    '''    const source: SourceCounts = sourcePreset === "unknown"
      ? unknown
      : {
          studentCount,
          externalCount: partySize - studentCount,
          middleGrade1Count: grades.m1,
          middleGrade2Count: grades.m2,
          middleGrade3Count: grades.m3,
          highGrade1Count: grades.h1,
          highGrade2Count: grades.h2,
          highGrade3Count: 0,
        };
    return {
      partySize,
      ...source,
      maleCount: sourcePreset === "mixed" ? maleCount : null,
      femaleCount: sourcePreset === "mixed" && maleCount != null ? partySize - maleCount : null,
      adultCount: sourcePreset === "mixed" ? adultCount : null,
      childCount: sourcePreset === "mixed" && adultCount != null ? partySize - adultCount : null,
    };
  }, [partySize, sourcePreset, studentCount, grades, maleCount, adultCount]);

  const gradeTotal = Object.values(grades).reduce((sum, value) => sum + value, 0);
  const unassignedGradeCount = Math.max(0, studentCount - gradeTotal);
  const mixedInvalid = sourcePreset === "mixed" && gradeTotal > studentCount;
''',
    "payload",
)

page = sub_once(
    page,
    r'          \{sourcePreset === "mixed" && <div className="demographic-details"><div className="detail-grid">.*?\n          </div></div>\}\n\n          \{overCapacity',
    '''          {sourcePreset === "mixed" && <div className="demographic-details"><div className="detail-grid">
            <section>
              <SplitSlider title="在校生 / 外部" lead="在校生" follow="外部" total={partySize} value={studentCount} onChange={changeStudentCount} />
              {studentCount > 0 && <div className="grade-block">
                <h4>学年</h4>
                <div className="grade-grid">
                  {([['m1','中1'],['m2','中2'],['m3','中3'],['h1','高1'],['h2','高2']] as [keyof typeof grades,string][]).map(([key,label]) => <CountEditor key={key} label={label} value={grades[key]} max={grades[key] + Math.max(0, studentCount - gradeTotal)} onChange={(value) => setGrades({ ...grades, [key]: value })} />)}
                </div>
                {unassignedGradeCount > 0 && <p className="validation-hint">未入力 {unassignedGradeCount}人</p>}
                {mixedInvalid && <p className="validation-error">学年人数が在校生人数を超えています</p>}
              </div>}
            </section>
            <SplitSlider title="男女" lead="男" follow="女" total={partySize} value={maleCount ?? Math.round(partySize / 2)} onChange={setMaleCount} />
            <SplitSlider title="大人 / 子供" lead="大人" follow="子供" total={partySize} value={adultCount ?? Math.round(partySize / 2)} onChange={setAdultCount} />
          </div></div>}

          {overCapacity''',
    "ui",
)

page_path.write_text(page)

test_path = Path("tests/safety-regressions.test.mjs")
tests = test_path.read_text()
new_test = '''test("詳細内訳は従来どおり詳細選択時にまとめて入力する", async () => {
  const page = await readFile(new URL("../app/reception-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /sourceKnown|genderKnown|ageKnown/);
  assert.match(page, /setMaleCount\\(\\(current\\) => current \\?\\? Math\\.round\\(partySize \\/ 2\\)\\)/);
  assert.match(page, /setAdultCount\\(\\(current\\) => current \\?\\? Math\\.round\\(partySize \\/ 2\\)\\)/);
  assert.match(page, /SplitSlider title="在校生 \\/ 外部"/);
  assert.match(page, /SplitSlider title="男女"/);
  assert.match(page, /SplitSlider title="大人 \\/ 子供"/);
  assert.match(page, /if \\(success\\) clearBreakdowns\\(\\)/);
});
'''
tests = sub_once(
    tests,
    r'test\("詳細内訳は未入力を保てて、登録成功後は人数以外をリセットする", async \(\) => \{.*?\n\}\);\n',
    new_test,
    "test",
)
test_path.write_text(tests)
