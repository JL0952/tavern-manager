function Toolbar({ children, className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 sm:gap-3 ${className}`}>
      {children}
    </div>
  );
}

export default Toolbar;
