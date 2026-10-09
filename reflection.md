# Reflection
## Experience
Constructing a simulation required us to have an in-depth comprehension of the principles behind such vulnerabilities. It then further solidified this comprehension by providing a neat visual model of the inner workings by displaying the data.
Advantages of the application:
- Shows the otherwise invisible data for visual learning.
- Tabs separate the two subjects while making it easily navigable.
- No compile time.
- Simulation poses no risk to the device.
## Workflow
High-level design choices were made via human discernment, and the more tedious parts were completed by AI via Copilot. This worked out well because the model being used (Claude Opus) had seldom struggled with languages like HTML and JavaScript from my experience. It also made the styling decent to look at while it was at it because it might as well look good. Although AI was used, the resulting code was always adequately reviewed and quality tested via human intervention.
For execution, manually open `index.html` or run `python -m http.server <port>` in the directory to run it as a server at `localhost:<port>`.