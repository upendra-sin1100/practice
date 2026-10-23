"""Check which questions are missing / what Q60 looks like"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(__file__).replace("analyze_papers.py", "infosys_prep"))
from parser import parse_paper

# Check paper 2
qs = parse_paper(r"D:\practice\backend\papers\Infosys_SE_Mock_Paper_2.pdf")
q_nums = [q['q_number'] for q in qs]
print(f"Paper 2 - Q nums: {sorted(q_nums)}")
print(f"Missing: {[n for n in range(1,61) if n not in q_nums]}")

# Show last 3 questions
for q in qs[-3:]:
    print(f"\nQ{q['q_number']}: {q['question'][:100]}")
    print(f"  opts: (a){q['opt_a'][:30]} (b){q['opt_b'][:30]}")
    print(f"  ans={q['correct_ans']}")
