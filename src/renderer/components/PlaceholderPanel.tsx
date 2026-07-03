type PlaceholderPanelProps = {
  title: string;
  description: string;
  items?: string[];
};

export const PlaceholderPanel = ({ title, description, items = [] }: PlaceholderPanelProps) => (
  <section className="placeholder-panel">
    <div className="panel-heading">
      <h2>{title}</h2>
      <span>Placeholder</span>
    </div>
    <p>{description}</p>
    {items.length > 0 ? (
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : null}
  </section>
);
