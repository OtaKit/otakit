'use dom';
export default function DOMFixture({ label }: { label: string }) {
  return (
    <main>
      <h1>OtaKit DOM: {label}</h1>
      <button onClick={() => (document.body.dataset.clicked = 'yes')}>Test DOM action</button>
    </main>
  );
}
